import PrintItemClient from "./print-client";

export default function Page({ params }: { params: { itemId: string } }) {
  return <PrintItemClient itemId={params.itemId} />;
}
