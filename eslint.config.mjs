// [목표] 1인 개발 초기: CI(Lint) 막힘 제거용 최소 룰 완화
// - @typescript-eslint/no-explicit-any: off (API route에서 any 사용 허용)
// - prefer-const: warn (let -> const 권고는 경고로만)

import tseslint from "typescript-eslint";
import next from "@next/eslint-plugin-next";

export default [
  // TypeScript 기본 권장 규칙(플러그인/파서 포함)
  ...tseslint.configs.recommended,

  // Next.js core-web-vitals 규칙 + 커스텀 완화
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { "@next/next": next },
    rules: {
      ...next.configs["core-web-vitals"].rules,

      // ✅ CI를 막던 규칙 완화
      "@typescript-eslint/no-explicit-any": "off",
      "prefer-const": "warn",
    },
  },
];
