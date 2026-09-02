import os
import re
import json
import base64
import traceback
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from fastapi import Depends, Header, HTTPException, Request

# .env 파일이 있으면 자동으로 로드 (로컬 개발 환경 지원)
load_dotenv()

def get_uid_or_ip(request: Request) -> str:
    """
    Authorization 헤더의 JWT(Firebase 토큰)에서 고유 식별자(UID)를 추출하여 반환합니다.
    토큰이 없거나 유효하지 않으면 기존처럼 IP 주소를 반환합니다.
    """
    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        try:
            token = auth.split(" ")[1]
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64).decode('utf-8'))
            return payload.get("user_id") or payload.get("sub") or get_remote_address(request)
        except Exception:
            pass
    return get_remote_address(request)

# ── Rate Limiter 설정 ─────────────────────────────────────────────────
# 구글 계정(UID) 기반으로 과도한 호출을 막아 Gemini API 과금 폭탄을 방어합니다.
# 같은 와이파이를 쓰더라도 각자의 계정 한도로 동작합니다.
limiter = Limiter(key_func=get_uid_or_ip)

# FastAPI 앱 초기화
app = FastAPI(title="Gemini API Proxy")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS 설정 ──────────────────────────────────────────────────────────
# 허용된 프론트엔드 도메인만 API를 호출할 수 있도록 제한합니다.
# (브라우저 기반 무단 호출 1차 차단. curl/스크립트는 Rate Limiter로 방어)
ALLOWED_ORIGINS = [
    "https://lecturebag.web.app",     # Firebase Hosting 프로덕션 URL
    "https://lecturebag.firebaseapp.com",  # Firebase 기본 도메인
    "http://localhost:5173",          # 로컬 Vite 개발 서버
    "http://localhost:4173",          # 로컬 Vite 프리뷰 서버
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

MODELS = [
    'gemini-3.6-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro'
]

def get_client():
    raw_key = os.environ.get("GEMINI_API_KEY", "")
    api_key = raw_key.strip().strip('"').strip("'")
    if not api_key:
        print("ERROR: GEMINI_API_KEY environment variable is not set!")
        raise HTTPException(status_code=500, detail="서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.")
    return genai.Client(api_key=api_key)

# ── Firebase ID Token 검증 (Authentication Gate) ──────────────────────
def verify_firebase_token(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="인증 헤더가 누락되었거나 올바르지 않습니다. (Bearer Token 필요)")
    
    token = authorization.split("Bearer ")[1]
    try:
        # Firebase Project ID 확인 (보안 필수: 타 프로젝트 토큰 위조 방지)
        # 백엔드 서버도 VITE_FIREBASE_PROJECT_ID 환경변수를 읽도록 하거나 문자열 하드코딩
        client_id = os.environ.get("VITE_FIREBASE_PROJECT_ID", "lecturebag")
        
        # google-auth의 verify_firebase_token을 활용하여 검증
        id_info = id_token.verify_firebase_token(token, google_requests.Request(), audience=client_id)
        return id_info
    except ValueError as e:
        print(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="유효하지 않거나 만료된 토큰입니다.")


class PromptRequest(BaseModel):
    prompt: str

class PromptResponse(BaseModel):
    text: str

class TimetableRequest(BaseModel):
    base64Image: str

class TimetableEntry(BaseModel):
    subject: str
    dayOfWeek: int
    startTime: str
    endTime: str

class TimetableResponse(BaseModel):
    entries: List[TimetableEntry]

class SummaryRequest(BaseModel):
    fileDataUrl: Optional[str] = None
    fileName: str

class SummaryResponse(BaseModel):
    summary: str

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Gemini Proxy Server is running!"}

@app.get("/api/models")
def list_available_models():
    try:
        client = get_client()
        models = [m.name for m in client.models.list()]
        return {"status": "ok", "available_models": models}
    except Exception as e:
        return {"status": "error", "error_message": str(e)}

@app.post("/api/generate", response_model=PromptResponse)
@limiter.limit("20/minute")  # IP당 분당 20회 제한
async def generate_content(request: Request, body: PromptRequest, user_info: dict = Depends(verify_firebase_token)):
    client = get_client()
    last_err = None
    for model_name in MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=body.prompt
            )
            return PromptResponse(text=response.text)
        except Exception as e:
            print(f"Error with model {model_name}: {e}")
            last_err = e
    traceback.print_exc()
    raise HTTPException(status_code=500, detail=str(last_err))

@app.post("/api/analyze-timetable", response_model=TimetableResponse)
@limiter.limit("10/minute")  # 시간표 분석은 대용량 이미지 처리 → 보수적 제한
async def analyze_timetable(request: Request, body: TimetableRequest, user_info: dict = Depends(verify_firebase_token)):
    try:
        client = get_client()
        
        base64_image = body.base64Image
        mime_match = re.match(r"^data:(image\/\w+);base64,", base64_image)
        mime_type = mime_match.group(1) if mime_match else "image/jpeg"
        base64_data = re.sub(r"^data:image\/\w+;base64,", "", base64_image)
        image_bytes = base64.b64decode(base64_data)

        prompt = """
You are an expert at parsing school and university timetables/schedules from images.
Analyze the provided timetable image and extract the schedule.
Return a valid JSON array where each element matches this exact structure:
[
  {
    "subject": "과목명",
    "dayOfWeek": 1, // Integer: 0 for Sunday, 1 for Monday, 2 for Tuesday, 3 for Wednesday, 4 for Thursday, 5 for Friday, 6 for Saturday
    "startTime": "09:00", // 24-hour HH:MM format
    "endTime": "11:50"    // 24-hour HH:MM format
  }
]
Output strictly raw JSON without any markdown formatting or commentary.
"""
        contents = [
            prompt,
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        ]
        
        last_err = None
        for model_name in MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents
                )
                cleaned_text = response.text.replace("```json", "").replace("```", "").strip()
                json_match = re.search(r"\[\s*\{[\s\S]*\}\s*\]", cleaned_text)
                json_to_parse = json_match.group(0) if json_match else cleaned_text
                parsed = json.loads(json_to_parse)
                
                if not isinstance(parsed, list):
                    raise ValueError("시간표 데이터가 올바른 배열 형식이 아닙니다.")
                    
                return TimetableResponse(entries=parsed)
            except Exception as e:
                print(f"Error with model {model_name}: {e}")
                last_err = e
                
        raise last_err if last_err else Exception("모든 모델 분석에 실패했습니다.")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/summarize", response_model=SummaryResponse)
@limiter.limit("10/minute")  # IP당 분당 10회 제한 (가장 무거운 AI 호출)
async def summarize_content(request: Request, body: SummaryRequest, user_info: dict = Depends(verify_firebase_token)):
    try:
        client = get_client()
        prompt = "내가 올리는 사진 혹은 음성 녹음에 있는 내용을 이해하기 쉽게 설명해줘. 내가 사진 혹은 음성 녹음을 계속 올릴 텐데, 그 전에 올렸던 사진과 음성 녹음의 내용들까지 합쳐서 정리하지 말고, 올린 사진의 내용만을 설명해줘. 내용을 자세하게 설명해줘. 정리한 내용을 Markdown 형식으로 정리해줘."
        
        contents = [prompt]
        if body.fileDataUrl and body.fileDataUrl.startswith("data:"):
            mime_match = re.match(r"^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+);base64,", body.fileDataUrl)
            mime_type = mime_match.group(1) if mime_match else "image/jpeg"
            
            fn = body.fileName.lower()
            if fn.endswith(".heic") or fn.endswith(".heif"):
                mime_type = "image/heic"
            elif fn.endswith(".m4a"):
                mime_type = "audio/mp4"
            elif mime_type == "application/octet-stream":
                mime_type = "image/jpeg"
                
            base64_data = re.sub(r"^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+);base64,", "", body.fileDataUrl)
            file_bytes = base64.b64decode(base64_data)
            contents.append(types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
        else:
            contents.append(f"[파일 데이터가 로드되지 않았습니다. 파일명: {body.fileName}]")
            
        last_err = None
        for model_name in MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents
                )
                return SummaryResponse(summary=response.text.strip())
            except Exception as e:
                print(f"Error with model {model_name}: {e}")
                last_err = e
                
        raise last_err if last_err else Exception("모든 모델 요약 생성에 실패했습니다.")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("proxy_server:app", host="0.0.0.0", port=port, reload=False)
