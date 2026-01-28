"use client";

export default function PrintItemClient({ itemId }: { itemId: string }) {
  return (
    <div>
      출력 테스트 – ITEM ID: {itemId}

      <style jsx global>{`
        @font-face {
          font-family: "PrintFont";
          src: url("/fonts/YourFont-Regular.woff2") format("woff2");
          font-weight: 400;
        }

        @font-face {
          font-family: "PrintFont";
          src: url("/fonts/YourFont-Bold.woff2") format("woff2");
          font-weight: 700;
        }

        body {
          font-family: "PrintFont", Arial, sans-serif;
        }
      `}</style>
    </div>
  );
}
