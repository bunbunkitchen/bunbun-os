export default function PageTitle({ title, subtitle }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold text-[#2D2D2D]">
        {title}
      </h1>

      {subtitle && (
        <p className="text-gray-500 mt-1">
          {subtitle}
        </p>
      )}
    </div>
  );
}