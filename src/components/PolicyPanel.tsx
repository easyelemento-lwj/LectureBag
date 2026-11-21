import { Mail } from 'lucide-react';
import { TermsContent } from './TermsContent';
import { PrivacyContent } from './PrivacyContent';

const sections = {
  terms: { title: '이용약관', body: `LectureBag은 사용자의 사진·녹음·시간표를 기기와 연결된 저장 공간에서 관리하도록 돕는 베타 서비스입니다.\n\n사용자는 본인이 권리를 가진 자료를 저장하고, 강의 촬영·녹음 시 학교와 강사의 규칙 및 관련 법령을 지켜야 합니다. 타인의 개인정보나 저작물을 허락 없이 공유하지 않아야 합니다.\n\n베타 기간에는 기능이 변경되거나 일시적으로 중단될 수 있습니다. 서비스는 자료가 안전하게 보존되도록 노력하지만, 중요한 자료는 별도로 백업해 주세요.\n\n문의: easyelemento@gmail.com` },
  privacy: { title: '개인정보 처리방침', body: `LectureBag 운영자는 서비스 제공을 위해 Google 로그인 식별자와 이메일, 사용자가 앱에 저장한 파일·시간표, Drive 연결 정보, 사용자가 제출한 피드백을 처리합니다.\n\n사진과 녹음은 파일 관리·동기화 기능을 위해 사용되며, 시간표 분석을 요청한 사진만 Gemini API로 전송됩니다. 한줄평은 서비스 개선을 위해 서버에 저장됩니다. 광고 목적으로 판매하지 않습니다.\n\n파일은 사용자가 삭제하거나 연결된 저장 공간에서 삭제될 때까지 보관하며, 피드백은 베타 운영과 개선에 필요한 기간 동안 보관합니다. 사용자는 앱에서 자료를 삭제하고 문의 이메일로 개인정보 삭제를 요청할 수 있습니다.\n\n문의 및 개인정보 보호 요청: easyelemento@gmail.com\n\n본 문서는 베타 단계 초안이며, 정식 출시 전 실제 운영 방식과 법률 검토 결과에 따라 업데이트합니다.` },
  beta: { title: '베타 운영 안내', body: `LectureBag은 현재 베타 테스트 중입니다. 테스트 기간에는 오류, 기능 변경, 일시적인 서비스 중단이 발생할 수 있습니다.\n\n오류나 의견은 앱 센터의 한줄평 남기기에서 보내주세요. 중요한 강의 자료는 별도로 백업해 주세요.\n\n운영자: LectureBag 운영자\n문의: easyelemento@gmail.com` },
} as const;

export function PolicyPanel({ kind }: { kind: keyof typeof sections }) {
  const section = sections[kind];
  return <article className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
    <h4 className="text-base font-bold text-neutral-900">{section.title}</h4>
    {kind === 'terms' ? <TermsContent /> : kind === 'privacy' ? <PrivacyContent /> : <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-neutral-600 select-text">{section.body}</p>}
    <a className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-neutral-700 underline" href="mailto:easyelemento@gmail.com"><Mail className="h-4 w-4" />문의 이메일</a>
  </article>;
}
