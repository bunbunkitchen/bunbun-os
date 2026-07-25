export default function Currency({
  value = 0,
}) {
  const numericValue = Number(value) || 0;

  return (
    <span>
      Rp{numericValue.toLocaleString("id-ID")}
    </span>
  );
}