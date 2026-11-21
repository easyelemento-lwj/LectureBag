const sections = [
  [
    "베타 서비스 안내",
    "LectureBag은 사진·녹음·시간표를 정리하고 Google Drive와 동기화하는 앱입니다. 베타 기간에는 오류나 기능 변경, 일시적인 중단이 있을 수 있습니다. 현재 앱 내 결제 기능은 없으며, 통신·Drive 이용 요금은 이용자의 별도 계약에 따릅니다."
  ],
  [
    "자료와 이용 규칙",
    "자료의 권리는 이용자 또는 정당한 권리자에게 있습니다. 촬영·녹음 시 학교와 강사의 규칙, 타인의 저작권과 개인정보를 존중해 주세요. 타인의 계정 도용이나 불법 자료 공유, 서비스 운영을 방해하는 행위는 금지합니다."
  ],
  [
    "저장·동기화 시 주의사항",
    "동기화는 지연되거나 실패할 수 있습니다. 동기화된 파일의 삭제·복원은 Drive와 다른 연결 기기에도 반영될 수 있습니다. 앱 쓰레기통은 삭제 후 30일 보관하며, 영구 삭제 후에는 복원이 어려울 수 있습니다. 중요한 자료는 별도로 백업해 주세요.\n시간표 분석을 요청한 이미지는 Google Gemini API로 전송됩니다. 인식 결과에 오류가 있을 수 있으므로 과목과 수업 시간을 확인해 주세요."
  ],
  [
    "이용 중단과 삭제 요청",
    "언제든 이용을 중단하거나 Drive 연결을 해제할 수 있습니다. 로그아웃·연결 해제는 계정 탈퇴나 자료 전체 삭제가 아닙니다. 탈퇴와 개인정보 삭제는 easyelemento@gmail.com으로 요청해 주세요. 기기·Drive의 원본과 다운로드 사본은 별도로 삭제해야 할 수 있습니다."
  ],
  [
    "운영과 문의",
    "운영자는 자료 보호와 안정적인 운영을 위해 노력하며, 베타 서비스라는 이유만으로 법적 책임을 면제하지 않습니다. 중요한 조건 변경이나 서비스 종료는 미리 알리고, 종료 시 자료를 내려받을 기회를 제공합니다. 위반 행위로 이용을 제한할 경우 사유를 안내하며, 이메일로 이의를 제기할 수 있습니다.\n문의: LectureBag 운영자 · easyelemento@gmail.com. 분쟁은 관련 법령과 절차에 따라 해결합니다."
  ]
] as const;

export function TermsContent() {
  return <div className="mt-4 space-y-5 break-words text-sm leading-7 text-neutral-600 select-text">
    <p className="text-xs text-neutral-500">베타용 초안 · 수정일 2026. 10. 21.</p>
    {sections.map(([title, body], index) => <section key={title}>
      <h5 className="font-semibold text-neutral-900">{index + 1}. {title}</h5>
      {body.split('\n').map(paragraph => <p key={paragraph} className="mt-2">{paragraph}</p>)}
    </section>)}
  </div>;
}
