import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

# FastAPI 앱 초기화
app = FastAPI(title="Gemini API Proxy")

# 웹/앱 클라이언트와의 통신을 위한 CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 실제 서비스 시 특정 도메인으로 제한 가능
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 환경변수에서 API 키 로드
API_KEY = os.environ.get("GEMINI_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)

model = genai.GenerativeModel('gemini-2.5-flash')

# 클라이언트 요청 모델
class PromptRequest(BaseModel):
    prompt: str

# 서버 응답 모델
class PromptResponse(BaseModel):
    text: str

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Gemini Proxy Server is running!"}

@app.post("/api/generate", response_model=PromptResponse)
async def generate_content(request: PromptRequest):
    if not os.environ.get("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.")
    try:
        # 클라이언트의 prompt를 받아 Gemini API 호출
        response = model.generate_content(request.prompt)
        
        # 결과 텍스트 반환
        return PromptResponse(text=response.text)
    
    except Exception as e:
        # 에러 발생 시 500 에러 반환
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Railway 등 클라우드 환경의 PORT 지원 (기본값: 8000)
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("proxy_server:app", host="0.0.0.0", port=port, reload=False)

