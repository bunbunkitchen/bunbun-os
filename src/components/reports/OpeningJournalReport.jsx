import { useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import Card from "../ui/Card";
import Currency from "../ui/Currency";

export default function OpeningJournalReport() {
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadOpeningJournal() {
      try {
        const { data, error } = await supabase.rpc("get_owner_opening_journal");
        if (error) throw error;
        if (active) setResult({ journal: data });
      } catch {
        if (active) setResult({ failed: true });
      }
    }

    loadOpeningJournal();
    return () => {
      active = false;
    };
  }, []);

  const journal = result?.journal;

  return (
    <Card className="mb-6">
      <h2 className="text-lg font-semibold text-gray-900">Saldo Awal Akuntansi</h2>
      {!result && <p role="status">Memuat saldo awal…</p>}
      {result?.failed && (
        <p role="alert" className="text-red-700">
          Saldo awal gagal dimuat. Muat ulang halaman untuk mencoba lagi.
        </p>
      )}
      {result && !result.failed && !journal && <p>Belum ada jurnal pembukaan terposting.</p>}
      {journal && (
        <>
          <p className="mt-1 text-sm text-gray-600">
            Jurnal pembukaan terposting • {journal.posting_date.split("-").reverse().join("/")}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table aria-label="Jurnal pembukaan" className="w-full text-sm">
              <thead className="border-b border-gray-200 text-gray-600">
                <tr>
                  <th scope="col" className="px-2 py-2 text-left">Akun</th>
                  <th scope="col" className="px-2 py-2 text-right">Debit</th>
                  <th scope="col" className="px-2 py-2 text-right">Kredit</th>
                </tr>
              </thead>
              <tbody>
                {journal.lines.map((line, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <th scope="row" className="px-2 py-2 text-left font-medium">
                      {line.label}
                    </th>
                    <td className="px-2 py-2 text-right"><Currency value={line.debit} /></td>
                    <td className="px-2 py-2 text-right"><Currency value={line.credit} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-semibold">
                <tr>
                  <th scope="row" className="px-2 py-2 text-left">Total</th>
                  <td className="px-2 py-2 text-right"><Currency value={journal.total_debit} /></td>
                  <td className="px-2 py-2 text-right"><Currency value={journal.total_credit} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
