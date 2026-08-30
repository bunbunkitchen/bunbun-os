import Card from "../ui/Card";
import Currency from "../ui/Currency";

function RejectBadge({ rate = 0 }) {
  let color = "text-[#595E48] bg-[#C7CDBF]";
  if (rate >= 5) color = "text-[#B56F69] bg-[#EECFCA]";
  else if (rate >= 2) color = "text-[#8F6A58] bg-[#C7A491]";
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${color}`}>{Number(rate).toFixed(2)} %</span>;
}

function TopProductList({ items = [], emptyText }) {
  if (!items.length) return <p className="text-[#777A6D]">{emptyText}</p>;
  const max = items[0]?.qty || 1;
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const percent = (item.qty / max) * 100;
        return (
          <div key={item.productId}>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-[#3F4335]"><span className="mr-2 font-semibold text-[#777A6D]">{index + 1}.</span>{item.nama}</span>
              <strong className="shrink-0 text-[#595E48]">{item.qty}</strong>
            </div>
            <div className="mt-1 h-2 rounded-full bg-[#ECE1DD]"><div className="h-2 rounded-full bg-[#C7A491]" style={{ width: `${percent}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export default function BusinessIntelligence({ data, productDemand, showFinance = false }) {
  if (!data) return null;
  return (
    <div>
      <h2 className="mb-5 text-2xl font-bold text-[#3F4335]">Business Intelligence</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-5 text-lg font-semibold text-[#3F4335]">{showFinance ? "Insight Bulan Ini" : "Insight Produksi"}</h3>
          <div className="space-y-4">
            {showFinance && <>
              <div className="flex justify-between"><span className="text-[#777A6D]">Income</span><strong className="text-[#595E48]"><Currency value={data.monthlyIncome} /></strong></div>
              <div className="flex justify-between"><span className="text-[#777A6D]">Expense</span><strong className="text-[#8F6A58]"><Currency value={data.monthlyExpense} /></strong></div>
              <div className="flex justify-between"><span className="text-[#777A6D]">Profit</span><strong className="text-[#595E48]"><Currency value={data.monthlyProfit} /></strong></div>
            </>}
            <div className="flex justify-between"><span className="text-[#777A6D]">Produksi Bulan Ini</span><strong className="text-[#3F4335]">{Number(data.monthlyFinished || 0).toLocaleString("id-ID")} pcs</strong></div>
            <div className="flex items-center justify-between"><span className="text-[#777A6D]">Reject Rate Hari Ini</span><RejectBadge rate={data.rejectRate || 0} /></div>
            <div className="flex justify-between"><span className="text-[#777A6D]">Stok Rendah</span><strong className="text-[#3F4335]">{data.lowStockCount || 0}</strong></div>
          </div>
        </Card>
        <Card>
          <h3 className="mb-5 text-lg font-semibold text-[#3F4335]">Top Produk Berdasarkan Penjualan</h3>
          <TopProductList items={productDemand?.topProductsBySales} emptyText="Belum ada penjualan bulan ini." />
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-5 text-lg font-semibold text-[#3F4335]">Top Produk Berdasarkan Barang Keluar</h3>
          <TopProductList items={productDemand?.topProductsByOutgoing} emptyText="Belum ada barang keluar bulan ini." />
        </Card>
        <Card>
          <h3 className="mb-4 text-lg font-semibold text-[#3F4335]">Batch Sedang Berjalan</h3>
          {!data.activeBatchItems?.length ? <p className="text-[#595E48]">Tidak ada batch aktif.</p> : (
            <div className="space-y-3">{data.activeBatchItems.map((batch) => (
              <div key={batch.id} className="rounded-lg border border-[#D9D8D0] bg-[#F5F3EE] p-3">
                <div className="font-semibold text-[#3F4335]">{batch.kode}</div>
                <div className="text-sm text-[#777A6D]">{batch.recipeNama}</div>
                <div className="mt-2 flex justify-between text-sm"><span className="text-[#777A6D]">{batch.status}</span><span className="font-medium text-[#595E48]">{batch.selesai} / {batch.target}</span></div>
              </div>
            ))}</div>
          )}
        </Card>
      </div>
      <div className="mt-6"><Card>
        <h3 className="mb-4 text-lg font-semibold text-[#3F4335]">Bahan Hampir Habis</h3>
        {data.lowStockCount === 0 ? <p className="text-[#595E48]">Semua stok aman.</p> : (
          <div className="space-y-3">{data.lowStockItems?.map((item) => (
            <div key={item.id} className="flex justify-between rounded-lg border border-[#EECFCA] bg-[#FAEFED] p-3">
              <div><div className="font-semibold text-[#3F4335]">{item.nama}</div><div className="text-sm text-[#777A6D]">Minimum {item.minimumStok} {item.satuan}</div></div>
              <strong className="text-[#B56F69]">{item.stok} {item.satuan}</strong>
            </div>
          ))}</div>
        )}
      </Card></div>
    </div>
  );
}
