# 기술 스택 선택

해당 직군: API/서비스로직/기획, DB/인프라, 프론트
상태: 시작 전
진행률: 100
최종 담당자: 연주 이, 원세찬, 문석용, 김효성, 서현석
날짜: 2026년 7월 17일 → 2026년 7월 19일
우선순위(프로젝트 전체 기준): 높음
후속 작업: DB 모델링 / DB 구성  (https://app.notion.com/p/DB-DB-39f058de39028027a422f03972c55698?pvs=21), 백엔드 개발 (https://app.notion.com/p/39f058de39028016968ec34f1634dcbd?pvs=21), 프론트 개발 (https://app.notion.com/p/39f058de390280a28e60d64520005735?pvs=21)

## 백엔드

언어 : Python

프레임 워크 :  FastAPI 

## 프론트

HTML, CSS, React, js, ts

## DB/인프라

DB : MYSQL

> 2026-07-29 확정. 초안에는 PostgreSQL로 적혀 있었으나 `db.md`의 모델링이 MySQL 기준으로 완료된 상태였고, 팀이 **MySQL**로 통일하기로 정했다([D-49](requirements.md#7-확정된-설계-결정)).

환경 격리 / 컨테이너화 : Docker, Docker Compose

클러스터 관리 : K8s

트래픽 분산 / 라우팅 : Nginx

배포 자동화 : GitHub Actions

## 5. 대안 비교 및 결정 근거

| **비교 항목** | **선택** | **보류한 대안** | **판단** |
| --- | --- | --- | --- |
| Frontend | React + Vite | Next.js | MVP는 SEO·SSR보다 실시간 SPA와 빠른 개발이 중요 |
| Backend | FastAPI | NestJS / Spring Boot | Python 경험을 활용하고 비동기 API·WebSocket을 한 흐름으로 학습 |
| DB | **MySQL** | PostgreSQL | 둘 다 운영하지 않고 한 DB로 통일한다. `db.md`의 모델링(스키마·인덱스·잠금 순서)이 이미 MySQL 기준으로 끝나 있어, 이쪽으로 맞추는 것이 다시 쓰는 비용이 없다 |
| 실시간 프로토콜 | Native WebSocket | `Socket.IO` | 의존성과 프로토콜을 단순화. 대신 재접속·방 상태 복구는 직접 구현 |
| 로컬 환경 | Docker Compose | Kubernetes만 사용 | 일상 개발은 단순하게 유지하고 배포 단계에서 Kubernetes 적용 |
