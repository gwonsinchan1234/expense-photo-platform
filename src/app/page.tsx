import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
        Expense Photo Platform
      </h1>

      <p style={{ fontSize: 14, marginBottom: 12 }}>
        개발/테스트는 photos-test 라우트에서 진행합니다.
      </p>

      <Link
        href="/photos-test"
        style={{
          display: "inline-block",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #ccc",
          background: "#fff",
          textDecoration: "none",
        }}
      >
        /photos-test로 이동
      </Link>
    </main>
  );
}
