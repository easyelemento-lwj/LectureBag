import os
import re
import json
import base64
import traceback
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from dotenv import load_dotenv

# .env 파일이 있으면 자동으로 로드 (로컬 개발 환경 지원)
load_dotenv()

# FastAPI 앱 초기화
app = FastAPI(title="Gemini API Proxy")

# 웹/앱 클라이언트와의 통신을 위한 CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash']

def get_client():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY environment variable is not set!")
        raise HTTPException(status_code=500, detail="서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.")
    return genai.Client(api_key=api_key.strip())

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

@app.post("/api/generate", response_model=PromptResponse)
async def generate_content(request: PromptRequest):
    client = get_client()
    last_err = None
    for model_name in MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=request.prompt
            )
            return PromptResponse(text=response.text)
        except Exception as e:
            print(f"Error with model {model_name}: {e}")
            last_err = e
    traceback.print_exc()
    raise HTTPException(status_code=500, detail=str(last_err))

@app.post("/api/analyze-timetable", response_model=TimetableResponse)
async def analyze_timetable(request: TimetableRequest):
    try:
        client = get_client()
        
        base64_image = request.base64Image
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
async def summarize_content(request: SummaryRequest):
    try:
        client = get_client()
        prompt = "내가 올리는 사진 혹은 음성 녹음에 있는 내용을 이해하기 쉽게 설명해줘. 내가 사진 혹은 음성 녹음을 계속 올릴 텐데, 그 전에 올렸던 사진과 음성 녹음의 내용들까지 합쳐서 정리하지 말고, 올린 사진의 내용만을 설명해줘. 내용을 자세하게 설명해줘. 정리한 내용을 Markdown 형식으로 정리해줘."
        
        contents = [prompt]
        if request.fileDataUrl and request.fileDataUrl.startswith("data:"):
            mime_match = re.match(r"^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+);base64,", request.fileDataUrl)
            mime_type = mime_match.group(1) if mime_match else "image/jpeg"
            
            fn = request.fileName.lower()
            if fn.endswith(".heic") or fn.endswith(".heif"):
                mime_type = "image/heic"
            elif fn.endswith(".m4a"):
                mime_type = "audio/mp4"
            elif mime_type == "application/octet-stream":
                mime_type = "image/jpeg"
                
            base64_data = re.sub(r"^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+);base64,", "", request.fileDataUrl)
            file_bytes = base64.b64decode(base64_data)
            contents.append(types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
        else:
            contents.append(f"[파일 데이터가 로드되지 않았습니다. 파일명: {request.fileName}]")
            
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
