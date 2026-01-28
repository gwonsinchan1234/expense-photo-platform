// [목표] 1인 개발 초기: CI(Lint) 막힘 제거 + Next/React Hooks 룰 정상 로드
// - react-hooks 플러그인을 Flat Config에 명시 등록(Definition not found 해결)
// - no-explicit-any: off (API route에서 any 허용)
// - prefer-const: warn (권고는 경고로만)

import tseslint from "typescript-eslint";
import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // TypeScript 기본 권장 규칙(플러그인/파서 포함)
  ...tseslint.configs.recommended,

  // Next + React Hooks 규칙 + 커스텀 완화
  {
    files: ["**/*.{js,jsx,ts,tsx}"],

    // ✅ Flat Config에서는 플러그인을 직접 등록해야 규칙 정의를 찾습니다.
    plugins: {
      "@next/next": next,
      "react-hooks": reactHooks,
    },

    rules: {
      // Next core-web-vitals rules
      ...next.configs["core-web-vitals"].rules,

      // React Hooks recommended rules (exhaustive-deps 포함)
      ...reactHooks.configs.recommended.rules,

      // ✅ CI 막던 규칙 완화
      "@typescript-eslint/no-explicit-any": "off",
      "prefer-const": "warn",
    },
  },
];
