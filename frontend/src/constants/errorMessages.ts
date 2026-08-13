// 서버 에러 코드 → 화면 문구·표시 방식 매핑 (F-CMN-04).
// 문구는 전부 docs/10_glossary/02_error_codes.md(에러 코드 42종의 정본)의 "사용자 문안" 칸을 그대로 옮겼다 —
// 이 파일에서 새로 짓지 않는다. 정본에 문구가 없는 코드는 없었다(42종 전부 문안 보유).
// REST(`src/api/rest.ts`의 ApiError)와 소켓(`src/realtime/client.ts`의 SocketError)이 같은 문자열 코드를 쓰므로
// 이 표 하나로 두 표면을 함께 커버한다 — 화면은 HTTP 상태나 서버가 보낸 message가 아니라 code로만 분기한다.

import type { ErrorCode } from '../protocol/types'

// 화면이 오류를 알리는 세 가지 방식.
// inline  — 입력값 자체가 잘못됐다. 그 입력 자리 옆에서 바로 보여줘야 무엇을 고칠지 알 수 있다 (REST 폼 제출 계열)
// toast   — 진행 중인 흐름을 순간적으로 거절당했다. 화면을 막지 않고 잠깐 보여주고 스스로 사라진다 (소켓 game:action·설정 변경 등)
// modal   — 방·연결·참가 자격 자체가 끝나는 사건이다. 사용자가 반드시 인지하고 다음 행동을 골라야 한다
export type ErrorDisplay = 'inline' | 'toast' | 'modal'

export interface ErrorPresentation {
  message: string
  display: ErrorDisplay
}

// 코드별 표시 방식 판단 기준은 각 항목 위 주석에 남긴다.
// **modal로 분류된 코드 대부분은 이미 room:closed·소켓 종료 코드가 `roomStore`의 closed 사유로 옮겨
// `ClosedScreen`(F-CMN-05·06)이 전용 화면으로 그린다** — 이 파일이 새 모달 UI를 만들지는 않는다.
// 여기서 modal로 적어 둔 것은 그 경로로 흘러가는 코드가 맞는지 앞으로 코드가 늘 때 확인할 기준을 남기기 위해서다.
export const ERROR_PRESENTATIONS: Record<ErrorCode, ErrorPresentation> = {
  /* ── room — 방의 존재·상태·정원·수명 ── */
  // 코드 입력란에 잘못된 값을 넣은 경우라 그 자리에서 바로 고치게 한다
  'room.not_found': { message: '없는 방이에요', display: 'inline' },
  // 입장 자체는 유효하지만 지금은 못 들어간다는 안내라, 잠깐 보여주고 사라지는 토스트보다
  // 사용자가 "언제 다시 시도할지"를 분명히 인지해야 하는 사건이다(F-CMN-07)
  'room.already_playing': { message: '게임이 진행 중이에요. 끝나면 들어올 수 있어요', display: 'modal' },
  // 코드 입력란에서 바로 알 수 있는 입장 실패다
  'room.full': { message: '방이 가득 찼어요', display: 'inline' },
  // 방 자체가 사라진 사건이라 대기방으로 돌아갈 곳이 없다 — ClosedScreen의 EXPIRED 카드로 이어진다
  'room.expired': { message: '오래 활동이 없어 방이 사라졌어요', display: 'modal' },
  // room:closed(reason HOST_LEFT)와 짝을 이루는 코드 — ClosedScreen의 HOST_LEFT 카드로 이어진다
  'room.host_left': { message: '방장이 나가서 방이 사라졌어요', display: 'modal' },
  // 방 만들기 제출이 실패한 것이라 그 화면의 제출 실패 표시 자리를 그대로 쓴다(순간적 거절이 아니라 폼 제출 실패)
  'room.code_exhausted': {
    message: '지금은 방을 만들 수 없어요. 잠시 뒤 다시 시도해 주세요',
    display: 'inline',
  },

  /* ── member — 참가자의 자격·프로필·권한 ── */
  // 방장이 강퇴를 누른 순간 대상이 이미 사라진 경우 — 방장에게만 잠깐 알리면 된다
  'member.not_found': { message: '찾을 수 없는 참가자예요', display: 'toast' },
  // 방장 전용 동작을 참가자가 시도한 순간적 거절 — 문서(07_common.md) 오류 안내 분기 표에 토스트로 명시돼 있다
  'member.not_host': { message: '방장만 할 수 있어요', display: 'toast' },
  // 프로필 확정 전 PENDING 상태에서 대기방 이벤트를 보낸 경우 — 프로필 화면에 잠깐 알리면 된다
  'member.not_active': { message: '프로필을 먼저 정해 주세요', display: 'toast' },
  // 닉네임 입력란 검증 실패 — 프로필 화면이 이미 입력란 옆에 그린다
  'member.nickname_invalid': { message: '닉네임은 1~8자로 적어 주세요', display: 'inline' },
  // 아바타 형식 검증 실패 — 아바타 그리드 자리에 붙는다
  'member.avatar_invalid': { message: '고를 수 없는 아바타예요', display: 'inline' },
  // 아바타 선점 경합 — 아바타 그리드 인라인. 프로필 화면이 이미 이 코드로 선택을 풀고 다시 고르게 한다
  'member.avatar_taken': {
    message: '방금 다른 분이 고른 아바타예요. 다른 걸 골라 주세요',
    display: 'inline',
  },
  // 한 줄 소개 입력란 검증 실패
  'member.bio_too_long': { message: '소개는 24자까지 적을 수 있어요', display: 'inline' },
  // 프로필 확정 재시도 — 폼 제출 실패 계열이라 인라인
  'member.already_active': { message: '이미 입장했어요', display: 'inline' },
  // 강퇴 통지 직후 소켓이 4403으로 닫힌다 — ClosedScreen의 KICKED 카드로 이어지는 사건이다
  'member.kicked': { message: '방장이 내보냈어요', display: 'modal' },
  // 방장이 자기 자신을 내보내려 한 순간적 거절
  'member.self_kick': { message: '자기 자신은 내보낼 수 없어요', display: 'toast' },

  /* ── game — 게임 선택·설정·라운드·단계·입력 자격 (전부 소켓 game:* 표면) ──
     설정 폼·인게임 화면 어디에도 필드 단위 인라인 자리가 없고, 전부 "지금 이 동작은 안 된다"는
     순간적 거절이라 13종 전부 toast로 통일한다. */
  'game.not_found': { message: '찾을 수 없는 게임이에요', display: 'toast' },
  'game.not_selected': { message: '게임을 먼저 골라 주세요', display: 'toast' },
  'game.invalid_config': { message: '설정값을 다시 확인해 주세요', display: 'toast' },
  'game.not_enough_members': { message: '사람이 더 모여야 시작할 수 있어요', display: 'toast' },
  'game.not_all_ready': { message: '아직 준비하지 않은 분이 있어요', display: 'toast' },
  'game.round_not_found': { message: '지난 판이라 반영되지 않았어요', display: 'toast' },
  'game.round_already_ended': { message: '이미 끝난 판이에요', display: 'toast' },
  'game.stale_phase': { message: '이미 지난 단계의 입력이에요', display: 'toast' },
  'game.invalid_action': { message: '지금은 할 수 없는 동작이에요', display: 'toast' },
  'game.already_submitted': { message: '이미 제출했어요', display: 'toast' },
  'game.not_eligible': { message: '이번 단계에서는 입력하지 않아도 돼요', display: 'toast' },
  // 실패가 아니라 통지다(02_error_codes.md) — 그래도 표시 자리는 같은 소켓 토스트를 그대로 쓴다
  'game.elapsed_rejected': { message: '기록이 서버 측정값으로 반영됐어요', display: 'toast' },
  'game.decision_not_required': { message: '지금은 고를 차례가 아니에요', display: 'toast' },

  /* ── vote — 표의 대상·수·중복 검증 (전부 소켓 game:action의 킹메이커·저격 투표) ──
     선택 UI에 후보별 인라인 검증 자리가 없어 game 네임스페이스와 같은 이유로 toast로 통일한다. */
  'vote.self_not_allowed': { message: '자기 자신은 고를 수 없어요', display: 'toast' },
  'vote.target_not_found': { message: '고를 수 없는 대상이에요', display: 'toast' },
  'vote.limit_exceeded': { message: '고를 수 있는 수를 넘었어요', display: 'toast' },
  'vote.duplicate_target': { message: '같은 대상은 한 번만 고를 수 있어요', display: 'toast' },

  /* ── common — 인증·스키마 검증·프로토콜·전역 실패 ── */
  // 인증 헤더 자체가 없거나 무효한 경우 — 세션이 깨진 것이라 재입장을 안내해야 한다
  'common.unauthenticated': { message: '다시 입장해 주세요', display: 'modal' },
  // 문서 표(07_common.md)가 "연결 끊김 → 재입장"을 모달로 못 박아 뒀다(F-CMN-05)
  'common.session_expired': { message: '연결이 만료됐어요. 다시 입장해 주세요', display: 'modal' },
  // REST 폼 제출의 스키마 검증 실패가 기본 상황이라 인라인으로 분류한다.
  // 소켓 game:action에서 나오는 경우는 그 화면의 기존 토스트 자리로 자연히 대체된다
  'common.validation_failed': { message: '입력값을 다시 확인해 주세요', display: 'inline' },
  // 멱등 키 충돌은 값이 잘못된 게 아니라 일시적 처리 실패라 "다시 시도"를 짧게 알리면 된다
  'common.idempotency_conflict': {
    message: '요청을 처리하지 못했어요. 다시 시도해 주세요',
    display: 'toast',
  },
  // 채팅 등에서 순간적으로 거절되는 입력
  'common.payload_too_large': { message: '내용이 너무 길어요', display: 'toast' },
  // 연타로 GET /api/rooms/{code}가 막힌 순간적 상황
  'common.rate_limited': { message: '요청이 잦아요. 잠시 뒤 다시 시도해 주세요', display: 'toast' },
  // 소켓이 곧바로 4002로 닫힌다 — 연결이 끝나는 사건이라 모달로 새로고침을 안내해야 한다
  'common.protocol_unsupported': { message: '화면을 새로고침해 주세요', display: 'modal' },
  // 소켓이 곧바로 4002로 닫힌다 — 위와 같은 이유로 모달
  'common.protocol_violation': {
    message: '연결에 문제가 생겼어요. 다시 입장해 주세요',
    display: 'modal',
  },
  // 분류 안 되는 서버 오류의 기본 처리 — 아래 기본값과 같은 문구를 쓴다
  'common.internal': { message: '잠시 문제가 생겼어요. 다시 시도해 주세요', display: 'toast' },
}

// 정본 42종 밖의 코드(아직 이 표에 없는 신설 코드, 혹은 소켓 프레임 파싱 단계에서 타입 단언만 거친 미검증 문자열)를
// 만났을 때 쓰는 안전망. common.internal과 같은 문구를 쓰고 화면을 막지 않는 토스트로 알린다.
const DEFAULT_PRESENTATION: ErrorPresentation = {
  message: '잠시 문제가 생겼어요. 다시 시도해 주세요',
  display: 'toast',
}

// 에러 코드 문자열로 화면 문구·표시 방식을 찾는다. 표에 없는 코드도 항상 값을 돌려준다(F-CMN-04의 "기본 문구" 요구).
export function presentError(code: string): ErrorPresentation {
  return (ERROR_PRESENTATIONS as Record<string, ErrorPresentation>)[code] ?? DEFAULT_PRESENTATION
}
