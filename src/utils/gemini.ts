import { TimetableEntry } from '../types';

export async function analyzeTimetableImage(base64Image: string, apiKey: string): Promise<TimetableEntry[]> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('API Key가 비어있습니다. 환경설정에서 Gemini API Key를 입력해주세요.');
  }

  // Extract mime type and base64 payload
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
    "dayOfWeek": 1, // Integer: 0 for Sunday, 1 for Monday, 2 for Tuesday, 3 for Wednesday, 4 for Thursday, 5 for Friday, 6 for Saturday
    "startTime": "09:00", // 24-hour HH:MM format
    "endTime": "11:50"    // 24-hour HH:MM format
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

  // 1. First, try to dynamically list available models for this user's API key
  let candidateModelNames: string[] = [];
  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData.models)) {
        candidateModelNames = listData.models
          .filter((m: any) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => m.name.replace(/^models\//, ''))
          // Sort to prioritize flash / fast vision models
          .sort((a: string, b: string) => {
            const aIsFlash = a.includes('flash');
            const bIsFlash = b.includes('flash');
            if (aIsFlash && !bIsFlash) return -1;
            if (!aIsFlash && bIsFlash) return 1;
            return 0;
          });
      }
    }
  } catch (e) {
    console.warn('Failed to dynamically query ListModels:', e);
  }

  // If ListModels returned empty or failed, use static candidate list
  if (candidateModelNames.length === 0) {
    candidateModelNames = [
      'gemini-1.5-flash',
      'gemini-1.5-flash-001',
      'gemini-1.5-flash-002',
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-pro-001',
      'gemini-pro',
    ];
  }

  console.log('Testing candidate models in order:', candidateModelNames);

  let lastErrorText = '';
  let lastStatus = 0;

  for (const model of candidateModelNames) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        lastStatus = response.status;
        lastErrorText = await response.text();
        console.warn(`Model ${model} returned error status ${response.status}:`, lastErrorText);
        continue;
      }

      const data = await response.json();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        throw new Error('Gemini API 응답에서 텍스트를 찾을 수 없습니다.');
      }

      const cleanedText = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
      const jsonMatch = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      const jsonToParse = jsonMatch ? jsonMatch[0] : cleanedText;
      const parsed = JSON.parse(jsonToParse);

      if (Array.isArray(parsed)) {
        return parsed as TimetableEntry[];
      } else {
        throw new Error('시간표 데이터가 배열 형식이 아닙니다.');
      }
    } catch (err: any) {
      console.warn(`Model ${model} execution error:`, err);
    }
  }

  throw new Error(`Gemini API 요청 실패 (${lastStatus}): ${lastErrorText || '지원되는 모델을 찾을 수 없습니다.'}`);
}

export async function generateAiSummary(fileDataUrl: string | undefined, fileName: string, apiKey: string): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('API Key가 비어있습니다. 환경설정에서 Gemini API Key를 입력해주세요.');
  }

  const prompt = `내가 올리는 사진 혹은 음성 녹음에 있는 내용을 이해하기 쉽게 설명해줘. 내가 사진 혹은 음성 녹음을 계속 올릴 텐데, 그 전에 올렸던 사진과 음성 녹음의 내용들까지 합쳐서 정리하지 말고, 올린 사진의 내용만을 설명해줘. 내용을 자세하게 설명해줘. 정리한 내용을 Markdown 형식으로 정리해줘.`;

  let parts: any[] = [{ text: prompt }];

  if (fileDataUrl && fileDataUrl.startsWith('data:')) {
    const mimeMatch = fileDataUrl.match(/^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+);base64,/);
    let mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    
    // HEIC 파일이지만 MIME 타입이 제대로 잡히지 않은 경우 명시적 매핑
    if (fileName.toLowerCase().endsWith('.heic') || fileName.toLowerCase().endsWith('.heif')) {
      mimeType = 'image/heic';
    } else if (fileName.toLowerCase().endsWith('.m4a')) {
      mimeType = 'audio/mp4';
    } else if (mimeType === 'application/octet-stream') {
      mimeType = 'image/jpeg';
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
    contents: [
      {
        parts: parts,
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };

  let candidateModelNames: string[] = [];
  try {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      if (Array.isArray(listData.models)) {
        candidateModelNames = listData.models
          .filter((m: any) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => m.name.replace(/^models\//, ''))
          .sort((a: string, b: string) => {
            const aIsFlash = a.includes('flash');
            const bIsFlash = b.includes('flash');
            if (aIsFlash && !bIsFlash) return -1;
            if (!aIsFlash && bIsFlash) return 1;
            return 0;
          });
      }
    }
  } catch (e) {
    console.warn('Failed to dynamically query ListModels:', e);
  }

  if (candidateModelNames.length === 0) {
    candidateModelNames = [
      'gemini-1.5-flash',
      'gemini-1.5-flash-001',
      'gemini-1.5-flash-002',
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-pro-001',
      'gemini-pro',
    ];
  }

  let lastErrorText = '';
  let lastStatus = 0;

  for (const model of candidateModelNames) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        lastStatus = response.status;
        lastErrorText = await response.text();
        console.warn(`Model ${model} returned error status ${response.status}:`, lastErrorText);
        continue;
      }

      const data = await response.json();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        throw new Error('Gemini API 응답에서 텍스트를 찾을 수 없습니다.');
      }

      return textResponse.trim();
    } catch (err: any) {
      console.warn(`Model ${model} execution error:`, err);
    }
  }

  throw new Error(`Gemini API 요청 실패 (${lastStatus}): ${lastErrorText || '지원되는 모델을 찾을 수 없습니다.'}`);
}
