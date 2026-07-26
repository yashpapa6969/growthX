// Storefront — the memory-seeding prologue. KEEP THIN (IDEA_SCOPE.md non-goals).
import { prisma } from "@/lib/db";
import { AssistantPanel } from "@/components/AssistantPanel";

export const dynamic = "force-dynamic";

async function getData() {
  try {
    const [products, rahul] = await Promise.all([
      prisma.product.findMany(),
      prisma.customer.findFirst({ where: { name: "Rahul Sharma" } }),
    ]);
    return { products, rahul };
  } catch {
    return { products: [], rahul: null }; // DB not migrated yet — render empty, don't crash.
  }
}

export default async function ShopPage() {
  const { products, rahul } = await getData();
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <h1 className="mb-4 text-xl font-bold">Sharma Kirana Store</h1>
        {products.length === 0 && <p className="text-sm text-gray-500">No products. Run <code>npm run db:push && npm run db:seed</code>.</p>}
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {products.map((p) => (
            <div key={p.id} className="rounded-lg border bg-white p-3">
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-gray-500">{p.nameHi}</div>
              <div className="mt-1 font-semibold text-khata">₹{p.price}</div>
            </div>
          ))}
        </div>
      </div>
      <aside>
        {rahul
          ? <AssistantPanel customerId={rahul.id} role="order" />
          : <div className="rounded-lg border bg-white p-4 text-sm text-gray-500">Seed the DB to load the customer.</div>}
      </aside>
    </div>
  );
}
