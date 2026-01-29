# Field Checklist

현장 1곳에서 실사용 가능한지 빠르게 확인하기 위한 체크리스트입니다.

## 사전 준비

- Supabase 프로젝트 생성 및 키 확인 완료
- 테이블 생성 완료(`expense_docs`, `expense_items` 등)
- Storage 버킷 생성 완료(`expense-photos`, `expense-evidence`)
- 엑셀 템플릿 존재 확인  
  - 경로: `public/templates/항목별사용내역서_template.xlsx`
- OCR 데이터 파일 존재 확인  
  - 경로: `public/tessdata/kor.traineddata`, `public/tessdata/eng.traineddata`

## 로컬 실행

1. 터미널에서 프로젝트 루트로 이동합니다.
2. 아래 명령어를 실행합니다.

```bash
npm install
npm run dev
```

3. 브라우저에서 `http://localhost:3000` 또는 `http://localhost:3001`로 접속합니다.

## 기본 흐름 확인

1. 엑셀 업로드로 품목을 등록합니다.
2. 품목별로 증빙 사진을 업로드합니다.
3. OCR 분류 결과를 확인합니다.
4. 엑셀 내보내기로 문서를 생성합니다.

## 운영 규칙(재발 방지)

1. dev 서버는 하나만 실행합니다. (`npm run dev` 중복 금지)
2. 접속 주소(3000/3001)를 항상 확인합니다.
3. 엑셀 업로드 전 미리보기 요약이 반드시 보여야 합니다.
4. 동일 문서 재업로드는 기존 데이터 삭제 후 진행합니다.
5. 화면 이상 시 강력 새로고침(`Ctrl + Shift + R`) 또는 시크릿 창에서 확인합니다.

## 엑셀 내보내기 확인

1. `http://localhost:3000/expense/export?docId=...` 또는 `3001`로 호출
2. 결과 엑셀에 품목과 사진이 들어가는지 확인

## 문제 발생 시 체크

- `.env.local`의 Supabase 키가 정확한지 확인
- Storage 버킷명이 코드와 동일한지 확인
- 템플릿 시트명이 코드와 동일한지 확인
- 콘솔 오류 로그 확인
