# 04_options_votes_results — 선택지·투표·결과

> **대상**: ModuPick — game_options · votes · game_results 세 테이블의 컬럼·제약·인덱스, 게임별 저장 범위, config·result JSON 스키마
> **작성일**: 2026-08-02
> **원천**: git 529e312 docs/db.md v0.5 §4 game_options·votes·game_results DDL · v0.4 §9 게임별 저장 테이블 사용 · §13 게임별 JSON 스키마 · git 529e312 docs/db.md「개발 전 반드시 정리할 문제」2(vote_no 의미)·3(입력 제약)·4(winner 컬럼 충돌) · git 529e312 docs/api.md(game:action 입력 표 · king.opinion 120자) · docs_legacy/requirements.md §3.4 방장 설정 항목 · §3.5 게임별 규칙 · §4.5 US-504 · frontend/src/games/Kingmaker.tsx(의견 120자)

세 테이블은 **판이 남기는 것**을 담는다. 무엇을 고를 수 있었는지(game_options) · 누가 무엇에 표를 줬는지(votes) · 최종적으로 무엇이 확정됐는지(game_results)다. 세 테이블 모두 방과 회차에 매달려 있고 밖으로 나가는 참조가 없다.

가장 중요한 경계는 **어떤 입력이 DB에 오고 어떤 입력이 인메모리에 머무는가**다. 초 단위로 도착하는 투표는 도착 즉시 기록하고, 밀리초 판정에 쓰는 입력은 기록하지 않는다 — 기록하는 순간 도착 시각이 아니라 커밋 시각을 재게 되기 때문이다.

## 저장 범위 — 게임 6종 전수

| 게임 | 참가자 입력 | 인메모리에만 두는 것 | game_options | votes | game_results |
|------|------------|--------------------|:------------:|:-----:|:------------:|
| 운명의 룰렛 | 없다(방장이 PICK 1회) | PICK 도착 시각·연출 진행 | **사용** — 참가자 후보 1인 1행 | 미사용 | **사용** — 당첨자·시드·조각 배치 |
| 사다리타기 | 없다(방장이 START 1회) | START 도착 시각·경로 애니메이션 | **사용** — 도착 항목(참가자 참조 없음) | 미사용 | **사용** — 배정·시드·가로선 배치 |
| 킹메이커 | 의견 제출 1회 · 투표 N회 | 제출·투표 완료 표시 · 후보 표시 순열 · 남은 표 수 | **사용** — 제출된 의견 1인 1행 | **사용** — 표 1개당 1행 | **사용** — 득표 집계·확정 안건 |
| 시간초 잡기 | START · STOP 각 1회 | **START·STOP 서버 도착 시각** · 경과 밀리초 · 순위 산출 | 미사용 | 미사용 | **사용** — 참가자별 경과·오차·순위 |
| 익명 저격 | 지목 1~N회 | 투표 완료 표시 · 남은 표 수 | **사용** — 지목 후보 1인 1행 | **사용** — 표 1개당 1행 | **사용** — 피격 수·확정 대상 |
| 눈치게임 | 라운드마다 UP 1회 | **UP 서버 도착 시각** · 판정창 그룹핑 · 생존자 명단 · 라운드 번호 | 미사용 | 미사용 | **사용** — 라운드별 판정 기록·최후 1인 |

**경계를 가르는 기준은 하나다 — 그 입력이 밀리초 단위로 판정되는가.**

| 축 | DB에 기록하는 입력 | 인메모리에만 두는 입력 |
|----|------------------|----------------------|
| 대상 | 킹메이커 의견 제출 · 킹메이커 투표 · 익명 저격 지목 | 눈치게임 UP · 시간초 START·STOP · 룰렛 PICK · 사다리 START |
| 판정 단위 | 표의 개수(초 단위 마감) | 서버 도착 시각의 밀리초 차이 |
| 왜 | 중복·초과 투표 차단을 UNIQUE가 맡아야 하고, 표는 개표까지 살아 있어야 한다 | DB 왕복이 끼면 도착 시각이 아니라 커밋 시각을 재게 되어 판정 자체가 틀어진다 |
| 남는 것 | 행 그대로 남는다 | **확정 결과만** game_results에 남는다 |

## 3. game_options — 선택지

| 컬럼명 | 타입 | NULL | 키 | 설명 |
|--------|------|:--:|----|------|
| id | BIGINT UNSIGNED | N | PK · UQ(id, game_round_id) | 내부 식별자. UQ는 votes 복합 FK의 대상 키다 |
| option_id | VARCHAR(40) ascii_bin | N | UQ | **외부 식별자.** opt_ 접두어 + 추측 불가 난수 문자열. 킹메이커 후보 식별자가 이 값이다 |
| game_round_id | BIGINT UNSIGNED | N | FK (game_round_id, room_id) → game_rounds(id, room_id) (**CASCADE**) | 소속 회차 |
| room_id | BIGINT UNSIGNED | N | 복합 FK 공통 축 | **교차 방 차단 축.** 회차와 참가자 양쪽이 같은 방인지를 DB가 대조한다 |
| participant_id | BIGINT UNSIGNED | Y | FK (participant_id, room_id) → participants(id, room_id) (**CASCADE**) | 참가자 후보(룰렛·저격) 또는 의견 작성자(킹메이커). 사다리 도착 항목은 NULL |
| label | VARCHAR(120) | N | | 화면 표시값 — 닉네임·도착 항목·의견 원문. CHECK로 공백 제거 후 1~120자 |
| sort_order | SMALLINT | N | UQ(game_round_id, sort_order) | 회차 내부 순서. CHECK로 0 이상 |

```sql
CREATE TABLE game_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  option_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  game_round_id BIGINT UNSIGNED NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  participant_id BIGINT UNSIGNED NULL,
  label VARCHAR(120) NOT NULL,
  sort_order SMALLINT NOT NULL,
  CONSTRAINT pk_game_options PRIMARY KEY (id),
  CONSTRAINT uq_game_options_option_id UNIQUE (option_id),
  CONSTRAINT uq_game_options_id_round UNIQUE (id, game_round_id),
  CONSTRAINT uq_game_options_round_order UNIQUE (game_round_id, sort_order),
  CONSTRAINT uq_game_options_round_participant
    UNIQUE (game_round_id, participant_id),
  CONSTRAINT fk_game_options_round FOREIGN KEY (game_round_id, room_id)
    REFERENCES game_rounds(id, room_id) ON DELETE CASCADE,
  CONSTRAINT fk_game_options_participant FOREIGN KEY (participant_id, room_id)
    REFERENCES participants(id, room_id) ON DELETE CASCADE,
  CONSTRAINT ck_game_options_option_id_format
    CHECK (REGEXP_LIKE(option_id, '^opt_[0-9A-Za-z]{16,36}$', 'c')),
  CONSTRAINT ck_game_options_label_len
    CHECK (CHAR_LENGTH(TRIM(label)) BETWEEN 1 AND 120),
  CONSTRAINT ck_game_options_sort_order CHECK (sort_order >= 0),
  INDEX idx_game_options_round_room (game_round_id, room_id),
  INDEX idx_game_options_participant_room (participant_id, room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- **uq_game_options_round_participant가 참가자당 선택지 1개를 강제한다.** 킹메이커에서 한 사람이 의견을 두 개 내는 것과 룰렛·저격에서 같은 참가자가 후보로 두 번 들어가는 것을 DB가 막는다. participant_id가 NULL인 사다리 도착 항목은 MySQL UNIQUE가 NULL을 여러 개 허용하므로 영향을 받지 않는다.
- **의견 제출의 멱등이 여기서 성립한다.** 같은 제출이 다시 도착하면 이 UNIQUE에 걸리고, 서버는 기존 행을 조회해 같은 성공 응답을 돌려준다. 별도 멱등 키 컬럼이 필요 없는 이유다.
- **label 120자는 킹메이커 의견 상한에서 온 값이다.** git 529e312 docs/db.md v0.4가 VARCHAR(100)을 두어 API의 120자와 어긋났던 것을 v0.5가 120으로 맞췄고 frontend/src/games/Kingmaker.tsx도 120자다.
- **sort_order를 외부에 노출하는 자리는 사다리 레인 하나뿐이다.** 킹메이커 후보의 표시 순서는 **인메모리 순열**이 정하고 sort_order를 내려보내지 않는다 — 제출 순서를 그대로 보여주면 제출 완료 표시와 대조해 작성자를 추정할 수 있어 익명성이 깨진다.
- **participant_id는 응답에서 제외한다.** 킹메이커에서 이 값은 작성자이며, 자기 안건 투표 차단에만 서버 내부에서 쓴다. 실명 공개 설정이 켜진 경우에도 **개표 후 결과 JSON을 통해서만** 나간다.

## 4. votes — 투표

| 컬럼명 | 타입 | NULL | 키 | 설명 |
|--------|------|:--:|----|------|
| id | BIGINT UNSIGNED | N | PK | 내부 식별자. 외부에 노출하지 않는다 |
| game_round_id | BIGINT UNSIGNED | N | FK (game_round_id, room_id) → game_rounds(id, room_id) (**CASCADE**) | 투표 대상 회차 |
| room_id | BIGINT UNSIGNED | N | 복합 FK 공통 축 | **교차 방 차단 축** |
| voter_participant_id | BIGINT UNSIGNED | N | FK (voter_participant_id, room_id) → participants(id, room_id) (**CASCADE**) | 투표자. **익명 게임에서도 저장하되 응답·로그에서 제외한다** |
| game_option_id | BIGINT UNSIGNED | N | FK (game_option_id, game_round_id) → game_options(id, game_round_id) (**CASCADE**) | 표가 가리키는 선택지. 복합 FK가 다른 회차 선택지를 차단한다 |
| ballot_no | SMALLINT | N | UQ 참여 | **결선 차수.** 1 = 본투표, 2~4 = 결선 1~3회. CHECK 1~4 |
| choice_no | SMALLINT | N | UQ 참여 | **그 차수에서 몇 번째 표인지.** 1부터. CHECK 1~10 |
| created_at | TIMESTAMP(6) | N | | 접수 시각. DEFAULT CURRENT_TIMESTAMP(6) |

```sql
CREATE TABLE votes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  room_id BIGINT UNSIGNED NOT NULL,
  voter_participant_id BIGINT UNSIGNED NOT NULL,
  game_option_id BIGINT UNSIGNED NOT NULL,
  ballot_no SMALLINT NOT NULL DEFAULT 1,
  choice_no SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_votes PRIMARY KEY (id),
  CONSTRAINT uq_votes_ballot
    UNIQUE (game_round_id, voter_participant_id, ballot_no, choice_no),
  CONSTRAINT fk_votes_round FOREIGN KEY (game_round_id, room_id)
    REFERENCES game_rounds(id, room_id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_voter FOREIGN KEY (voter_participant_id, room_id)
    REFERENCES participants(id, room_id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_option FOREIGN KEY (game_option_id, game_round_id)
    REFERENCES game_options(id, game_round_id) ON DELETE CASCADE,
  CONSTRAINT ck_votes_ballot_no CHECK (ballot_no BETWEEN 1 AND 4),
  CONSTRAINT ck_votes_choice_no CHECK (choice_no BETWEEN 1 AND 10),
  INDEX idx_votes_round_room (game_round_id, room_id),
  INDEX idx_votes_voter_room (voter_participant_id, room_id),
  INDEX idx_votes_option_round (game_option_id, game_round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

### ballot_no와 choice_no — vote_no를 둘로 나눈 이유

git 529e312 docs/db.md는 vote_no 하나만 두고 "의미가 불명확하다"를 미해결로 남겼다. 한 축에 **재투표 차수**와 **한 차수에서 행사한 표의 순번**이라는 서로 다른 두 개념이 섞여 있었기 때문이다. 둘로 나눠 닫는다.

| 축 | 의미 | 값 | 정하는 주체 |
|----|------|-----|------------|
| ballot_no | 결선 차수 | 1 = 본투표 · 2 = 결선 1회 · 3 = 결선 2회 · 4 = 결선 3회 | 서버 인메모리의 현재 TIE 차수 |
| choice_no | 그 차수에서 몇 번째 표인지 | 1부터 순차. 1인 1표 게임은 항상 1 | 서버가 접수 순서대로 배정 |

- **상한 4는 반복 상한에서 나온다.** 동점 결선은 최대 3회이고 3회에도 단독 승자가 없으면 방장이 고른다([../README.md](../README.md) 고정 기준). 본투표 1 + 결선 3 = 4가 ballot_no의 최댓값이며 CHECK가 그것을 넘지 못하게 한다. **종료가 보장되지 않는 반복이 DB 수준에서도 불가능하다.**
- **상한 10은 방 정원에서 나온다.** 한 사람이 행사할 수 있는 표는 어떤 게임 설정에서도 후보 수를 넘지 않고 후보 수는 정원 10을 넘지 않는다. 게임별 실제 상한(킹메이커 1~3표 · 저격 1~2표)은 앱이 강제한다.
- **재전송 흡수는 1인 1표 게임에서 자동으로 성립한다.** choice_no가 항상 1이므로 같은 표가 다시 도착하면 uq_votes_ballot에 걸리고, 서버는 기존 행을 조회해 같은 성공 응답을 돌려준다.
- **다표 게임의 남은 표 수는 인메모리가 센다.** 표를 다 쓴 뒤 도착한 입력은 DB에 닿기 전에 거절한다. 이 값을 DB 카운트로 계산하지 않는 이유는 카운트와 INSERT 사이의 경쟁을 막으려면 회차 전체를 잠가야 하기 때문이다.
- **같은 선택지에 여러 표를 주는 것을 DB가 막지 않는다.** 몰아주기 허용 여부는 게임마다 다르고 규칙 정본이 [../05_game_rules/README.md](../05_game_rules/README.md)이므로 앱이 강제한다.
- **자기 투표 금지도 앱이 강제한다.** 킹메이커의 자기 안건 투표와 저격의 자기 지목은 game_options.participant_id와 voter_participant_id를 대조해야 알 수 있고, MySQL CHECK는 다른 행을 조회할 수 없다.

## 5. game_results — 확정 결과

| 컬럼명 | 타입 | NULL | 키 | 설명 |
|--------|------|:--:|----|------|
| id | BIGINT UNSIGNED | N | PK | 내부 식별자 |
| game_round_id | BIGINT UNSIGNED | N | FK → game_rounds.id (**CASCADE**) · UQ | 회차. **회차당 결과 최대 1행** |
| result_data | JSON | N | | 게임별 결과. **결과의 단일 기준이다** |
| created_at | TIMESTAMP(6) | N | | 확정 시각. DEFAULT CURRENT_TIMESTAMP(6) |

```sql
CREATE TABLE game_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_round_id BIGINT UNSIGNED NOT NULL,
  result_data JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT pk_game_results PRIMARY KEY (id),
  CONSTRAINT uq_game_results_round UNIQUE (game_round_id),
  CONSTRAINT fk_game_results_round FOREIGN KEY (game_round_id)
    REFERENCES game_rounds(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- **승자 컬럼을 두지 않는다.** git 529e312 docs/db.md는 winner_participant_id와 result_data가 충돌할 수 있음을 미해결로 남겼다 — 사다리는 전원 배정이고, 저격은 무효표 처리에서 복수 후보가 남을 수 있으며, 눈치게임은 "뽑힌 사람"이 승자가 아니라 최후 1인이다. 승자를 한 명으로 못 박는 컬럼은 절반의 게임에서 의미가 어긋나고, 두 곳에 저장된 결과가 갈라질 위험만 남는다. **전적·통계 조회가 범위 밖이라 승자로 인덱스 조회할 요구도 없다.** result_data 하나를 단일 기준으로 삼는다.
- **result_version 컬럼도 두지 않는다.** 버전은 result_data 안의 schemaVersion 하나가 정본이다. 두 자리에 버전을 두면 조용히 갈라진다.
- **CHECK 제약이 하나도 없는 유일한 테이블이다.** JSON 내부 구조는 게임별 Pydantic 모델이 저장 전에 검증한다. MySQL CHECK로 JSON 내부를 검사하면 스키마가 DDL과 코드 두 곳에 생겨 마이그레이션마다 함께 고쳐야 한다.
- **room_id를 두지 않는 유일한 하위 테이블이다.** 참가자를 참조하는 컬럼이 없어 교차 방 참조 경로가 애초에 없다. room_id는 참가자를 참조하는 테이블에만 둔다.
- **UNIQUE(game_round_id)가 결과 확정을 멱등하게 만든다.** 이미 끝난 판에 확정 요청이 다시 오면 UNIQUE에 걸리고 서버는 기존 결과를 돌려준다.

## 게임별 JSON 스키마

**자유 형식이 아니다.** 게임별 Pydantic 모델과 schemaVersion으로 검증한 뒤 저장하고, 필드 의미가 바뀌면 기존 데이터를 덮어쓰지 않고 버전을 올린다. 아래 표는 **저장 형식의 정본**이며, 각 필드가 어떤 규칙에서 나온 값인지는 [../05_game_rules/README.md](../05_game_rules/README.md)가 정본이다.

**공통 규약**

| 규칙 | 내용 |
|------|------|
| 식별자 | 참가자는 memberId(mbr_...), 선택지는 optionId(opt_...) — **외부 불투명 ID를 쓴다.** result_data는 결과 이벤트 payload로 그대로 나가므로 내부 BIGINT PK를 담으면 유출된다 |
| 시간 | 전부 **정수 밀리초**다. 부동소수점 초를 쓰지 않는다 |
| 승자 | 게임을 가리지 않고 **배열**이다. 한 명뿐인 게임도 원소 1개 배열로 담아 소비 코드가 갈라지지 않게 한다 |
| 버전 | config·result 각각 schemaVersion을 갖는다. 현재 전부 1이다 |
| 크기 | JSON 최대 바이트 크기는 API 계층이 제한한다 |

| 게임 | config 핵심 값 | result_data 핵심 값 |
|------|---------------|---------------------|
| 운명의 룰렛 | schemaVersion · topic | schemaVersion · seed · winnerMemberIds[] · wheelOrder[](조각 배치, 입장 순서) |
| 사다리타기 | schemaVersion · topic · speed · destinations[] | schemaVersion · seed · assignments[{memberId, optionId, label}] · ladderRungs[{row, leftLane}] |
| 킹메이커 | schemaVersion · topic · votesPerMember · revealAuthors · submitSec · voteSec | schemaVersion · tally[{optionId, label, voteCount}] · winnerOptionIds[] · ballotRounds · authors[{optionId, memberId}](revealAuthors일 때만) |
| 시간초 잡기 | schemaVersion · topic · targetMs · judgeMode · limitMs · startGraceMs | schemaVersion · records[{memberId, elapsedMs, diffMs, absDiffMs, rank, status}] · winnerMemberIds[] · rematchRounds |
| 익명 저격 | schemaVersion · topic · voteSec · allowMultiVote | schemaVersion · tally[{memberId, hitCount}] · winnerMemberIds[] · ballotRounds · abstainCount · decidedByRandom |
| 눈치게임 | schemaVersion · topic · judgeWindowMs · roundLimitSec | schemaVersion · rounds[{roundNo, presses[{memberId, offsetMs, verdict}], safeMemberIds[], remainingMemberIds[]}] · loserMemberIds[] · voidRound |

**값 규약**

| 필드 | 값 |
|------|-----|
| speed(사다리) | fast · normal · slow. **애니메이션 길이만 바꾸고 결과에 영향을 주지 않는다** |
| judgeMode(시간초) | closest · farthest |
| status(시간초 records) | recorded(정상 기록) · no_start(제한 안에 시작하지 않음) · no_stop(제한 안에 멈추지 않음). 뒤 둘은 최하위로 처리된다 |
| judgeWindowMs(눈치 config) | 판정창 폭. **300 또는 500**이며 방장이 고른다. 창 폭과 그룹핑 규칙의 정본은 [../05_game_rules/07_nunchi.md](../05_game_rules/07_nunchi.md)이고 본 문서는 저장 형식만 고정한다 |
| verdict(눈치 presses) | alone(혼자 눌러 안전 확정) · overlapped(판정창 안 동시 입력) · none(미입력) |
| offsetMs(눈치) | 그 라운드 시작 기준 **서버 도착 시각**의 오프셋. 클라이언트가 보낸 시각이 아니다 |
| ballotRounds | 실제로 진행한 결선 차수. votes.ballot_no의 최댓값과 같다 |
| decidedByRandom(저격) | 전원 기권으로 유효표가 0이라 난수로 정한 경우 true. **표가 없었음을 결과 화면이 표시한다** |
| voidRound(눈치) | 생존자 전원이 같은 판정창에 눌러 아무도 안전 확정하지 못한 무효 라운드로 끝난 경우 true |
| authors · voters | **설정이 공개일 때만, 그것도 개표 후에만 실린다.** 비공개면 키 자체를 담지 않는다 |

- **익명 게임의 식별 정보는 두 겹으로 막는다.** DB에는 voter_participant_id·participant_id를 저장하되, (1) 일반 응답·로그에서 제외하고 (2) 결과 JSON에는 공개 설정이 켜진 경우에만 개표 후 담는다. 저장을 없애면 중복 투표를 막을 수 없으므로 저장은 유지하고 노출 경로만 닫는다.
- **결과와 시드는 반드시 일치한다.** result_data.seed는 game_rounds.random_seed와 같은 값이며, 다르면 결과 재현이 성립하지 않는다.

## 결과·시드의 보관과 삭제

**방이 사라지면 결과와 시드도 사라진다. 예외를 두지 않는다.**

| 축 | 결정 |
|----|------|
| 보관 기간 | 방 수명과 정확히 같다. 방 삭제 시 CASCADE로 함께 사라진다 |
| 보관 예외 | **두지 않는다.** 결과만 따로 남기는 아카이브 테이블·백업 경로를 만들지 않는다 |
| 방 안에서의 재열람 | 대기방으로 돌아오면 그 판의 결과를 다시 보여주지 않는다. 행은 남아 있지만 표시 경로가 없다 |
| 참가자가 갖는 사본 | 결과 화면의 **PNG 저장**이다. 전원이 저장할 수 있다 |

**이의 제기 시 재현 근거가 사라지는 문제를 알고도 예외를 두지 않는 근거**는 셋이다.

1. **접수할 창구가 없다.** 로그인·계정이 없어 이의를 제기한 사람이 그 판의 참가자였는지 확인할 수단이 없다. 신원을 확인할 수 없는 이의를 받으려면 계정 체계가 필요하고 그것은 범위 밖이다.
2. **가벼움이 제품의 원칙이다.** 개인정보를 방 수명 밖으로 들고 가지 않는다는 것이 명시된 제품 결정(docs_legacy/requirements.md D-38 · NFR-08·NFR-09)이며, 결과 보관 예외는 닉네임·소개·투표 이력을 함께 남기게 된다.
3. **사본이 참가자 손에 있다.** 결과 화면 PNG에는 주제·게임 이름·결과·참가자·날짜가 담긴다. 분쟁의 실제 형태는 "결과가 무엇이었나"이지 "서버 난수가 정당했나"가 아니다.

**대신 방이 살아 있는 동안은 재현 가능성을 보장한다.** random_seed · config · game_options · votes가 모두 남아 있어 같은 방 안에서는 결과를 다시 계산해 대조할 수 있다. 판정 근거를 서버 애플리케이션 로그로 남기되 **닉네임·소개·투표자 식별값은 로그에 남기지 않는다**.

## 인덱스

| 테이블 | 인덱스 | 구성 | 용도 |
|--------|--------|------|------|
| game_options | pk_game_options | PK(id) | 내부 조회 |
| game_options | uq_game_options_option_id | UNIQUE(option_id) | 외부 ID 조회 |
| game_options | uq_game_options_id_round | UNIQUE(id, game_round_id) | **votes 복합 FK의 대상 키** |
| game_options | uq_game_options_round_order | UNIQUE(game_round_id, sort_order) | 회차 내 순서 유일 |
| game_options | uq_game_options_round_participant | UNIQUE(game_round_id, participant_id) | **참가자당 선택지 1개** |
| game_options | idx_game_options_round_room | (game_round_id, room_id) | fk_game_options_round 커버 |
| game_options | idx_game_options_participant_room | (participant_id, room_id) | fk_game_options_participant 커버 |
| votes | pk_votes | PK(id) | 내부 조회 |
| votes | uq_votes_ballot | UNIQUE(game_round_id, voter_participant_id, ballot_no, choice_no) | **중복·재전송 차단.** 개표 조회 축도 겸한다 |
| votes | idx_votes_round_room | (game_round_id, room_id) | fk_votes_round 커버 |
| votes | idx_votes_voter_room | (voter_participant_id, room_id) | fk_votes_voter 커버 |
| votes | idx_votes_option_round | (game_option_id, game_round_id) | fk_votes_option 커버 · 선택지별 득표 집계 |
| game_results | pk_game_results | PK(id) | 내부 조회 |
| game_results | uq_game_results_round | UNIQUE(game_round_id) | **회차당 결과 1행.** fk_game_results_round 커버를 겸한다 |

FK 커버 인덱스를 전부 이름 붙여 선언하는 이유는 MySQL이 맞는 인덱스를 못 찾으면 이름 없는 인덱스를 자동 생성하기 때문이다. 모든 인덱스에 고정된 이름을 준다는 규약이 그것을 허용하지 않는다.

## 관련 문서

- 회차 상태·시드 발급 → [03_game_rounds.md](./03_game_rounds.md)
- 참가자 신원·익명성 저장 축 → [02_rooms_participants.md](./02_rooms_participants.md)
- 제약 전수·DB와 앱의 강제 분담 → [05_constraints_integrity.md](./05_constraints_integrity.md)
- 투표·결과 확정 트랜잭션과 멱등 → [06_transactions_concurrency.md](./06_transactions_concurrency.md)
- 게임 규칙·판정 알고리즘·경계값 → [../05_game_rules/README.md](../05_game_rules/README.md)
- 익명성 유출 경로 검토 → [../11_fairness/README.md](../11_fairness/README.md)
- 게임 입력 이벤트 계약 → [../07_api/03_socket_events.md](../07_api/03_socket_events.md)
