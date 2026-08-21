import { TimetableEntry } from '../types';

const PROXY_SERVER_URL = import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app';

export async function analyzeTimetableImage(base64Image: string, apiKey?: string): Promise<TimetableEntry[]> {
  let proxyErrorMsg = '';

  // 1. 프록시 서버(Railway)를 통한 요청 시도
  try {
    const res = await fetch(`${PROXY_SERVER_URL}/api/analyze-timetable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Image }),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        return data.entries;
      }
    } else {
      const errText = await res.text();
      proxyErrorMsg = `서버 응답 오류 (${res.status}): ${errText}`;
      console.warn('Proxy server error on analyze-timetable:', errText);
    }
  } catch (proxyErr: any) {
    proxyErrorMsg = `서버 연결 실패: ${proxyErr?.message || proxyErr}`;
    console.warn('Failed to reach proxy server:', proxyErr);
  }

  // 2. 프록시 실패 시 (또는 사용자가 직접 입력한 로컬 API 키가 있을 경우) Fallback
  const cleanKey = apiKey ? apiKey.trim() : '';
  if (!cleanKey) {
    throw new Error(`백엔드 서버 통신에 실패했습니다. (${proxyErrorMsg || '응답 없음'})`);
  }

  const mimeMatch = base64Image.match(/^data:(image\/\w+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

  const prompt = `
You are an expert at parsing school and university timetables/schedules from images.
Analyze the provided timetable image and extract the schedule.
Return a valid JSON array where each element matches this exact structure:
[
  {
    "subject": "과목명",
    "dayOfWeek": 1,
    "startTime": "09:00",
    "endTime": "11:50"
  }
]
Output strictly raw JSON without any markdown formatting or commentary.
`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
    },
  };

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textResponse) continue;

      const cleanedText = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
      const jsonMatch = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      const jsonToParse = jsonMatch ? jsonMatch[0] : cleanedText;
      return JSON.parse(jsonToParse) as TimetableEntry[];
    } catch (e) {
      console.warn(`Direct fallback failed for ${model}:`, e);
    }
  }

  throw new Error('시간표 분석에 실패했습니다.');
}

export async function generateAiSummary(fileDataUrl: string | undefined, fileName: string, apiKey?: string): Promise<string> {
  let proxyErrorMsg = '';

  // 1. 프록시 서버(Railway)를 통한 요청 시도
  try {
    const res = await fetch(`${PROXY_SERVER_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileDataUrl, fileName }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.summary) {
        return data.summary;
      }
    } else {
      const errText = await res.text();
      proxyErrorMsg = `서버 응답 오류 (${res.status}): ${errText}`;
      console.warn('Proxy server error on summarize:', errText);
    }
  } catch (proxyErr: any) {
    proxyErrorMsg = `서버 연결 실패: ${proxyErr?.message || proxyErr}`;
    console.warn('Failed to reach proxy server:', proxyErr);
  }

  // 2. 프록시 실패 시 Direct API Fallback
  const cleanKey = apiKey ? apiKey.trim() : '';
  if (!cleanKey) {
    throw new Error(`백엔드 서버 통신에 실패했습니다. (${proxyErrorMsg || '응답 없음'})`);
  }

  const prompt = `내가 올리는 사진 혹은 음성 녹음에 있는 내용을 이해하기 쉽게 설명해줘. 내가 사진 혹은 음성 녹음을 계속 올릴 텐데, 그 전에 올렸던 사진과 음성 녹음의 내용들까지 합쳐서 정리하지 말고, 올린 사진의 내용만을 설명해줘. 내용을 자세하게 설명해줘. 정리한 내용을 Markdown 형식으로 정리해줘.`;

  let parts: any[] = [{ text: prompt }];
  if (fileDataUrl && fileDataUrl.startsWith('data:')) {
    const mimeMatch = fileDataUrl.match(/^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+);base64,/);
    let mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    if (fileName.toLowerCase().endsWith('.heic') || fileName.toLowerCase().endsWith('.heif')) {
      mimeType = 'image/heic';
    } else if (fileName.toLowerCase().endsWith('.m4a')) {
      mimeType = 'audio/mp4';
    }
    const base64Data = fileDataUrl.replace(/^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+);base64,/, '');
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Data,
      },
    });
  } else {
    parts.push({ text: `[파일 데이터가 로드되지 않았습니다. 파일명: ${fileName}]` });
  }

  const requestBody = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.2 },
  };

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) continue;
      const data = await response.json();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (textResponse) return textResponse.trim();
    } catch (e) {
      console.warn(`Direct fallback failed for ${model}:`, e);
    }
  }

  throw new Error('AI 요약 생성에 실패했습니다.');
}
