"use client";

// Read-only DB viewer table. Rows are plain objects already serialized on the
// server (Date -> ISO string, Json kept as plain objects/arrays) so nothing here
// crosses the server->client boundary as a non-serializable value.

type Props = { name: string; rows: any[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const MAX_LEN = 200;

function inferType(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return ISO_DATE.test(v) ? "DateTime" : "String";
  if (typeof v === "boolean") return "Boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "Int" : "Float";
  if (Array.isArray(v)) return "Json[]";
  if (typeof v === "object") return "Json";
  return typeof v;
}

function renderCell(v: unknown) {
  if (v === null || v === undefined) {
    return <span className="text-gray-300">—</span>;
  }
  if (typeof v === "string") {
    if (ISO_DATE.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        return <span title={v} className="whitespace-nowrap tabular-nums">{d.toLocaleString()}</span>;
      }
    }
    const truncated = v.length > MAX_LEN ? v.slice(0, MAX_LEN) + "…" : v;
    return <span title={v.length > MAX_LEN ? v : undefined}>{truncated}</span>;
  }
  if (typeof v === "boolean") {
    return <span className={v ? "text-green-600" : "text-gray-400"}>{String(v)}</span>;
  }
  if (typeof v === "number") {
    return <span className="tabular-nums">{v}</span>;
  }
  // object / array (Json fields such as Order.items, Persona.toneParams)
  const json = JSON.stringify(v);
  const truncated = json.length > MAX_LEN ? json.slice(0, MAX_LEN) + "…" : json;
  return (
    <code title={json.length > MAX_LEN ? json : undefined} className="text-xs text-gray-700">
      {truncated}
    </code>
  );
}

export function DbTable({ name, rows }: Props) {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <section className="rounded-lg border bg-white">
      <div className="flex items-baseline justify-between border-b bg-gray-50 px-4 py-2">
        <h2 className="text-sm font-semibold">{name}</h2>
        <span className="text-xs text-gray-400">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
      </div>

      {columns.length > 0 && (
        <div className="border-b px-4 py-1.5 text-[11px] text-gray-400">
          {columns.map((c, i) => (
            <span key={c}>
              {i > 0 && " · "}
              <span className="text-gray-500">{c}</span>
              <span className="text-gray-300">:{inferType(rows[0][c])}</span>
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-400">no rows</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="whitespace-nowrap p-2 font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={row.id ?? ri} className="border-t align-top">
                  {columns.map((c) => (
                    <td key={c} className="max-w-md p-2">{renderCell(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
