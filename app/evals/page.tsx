// Agent eval suite — 28 scripted collection-call scenarios graded against ground-truth
// dispositions. Run the whole suite (optionally per persona) to get an objective pass rate.
import { prisma } from "@/lib/db";
import { EVAL_CASES } from "@/lib/evals/cases";
import { EvalRunner } from "@/components/EvalRunner";

export const dynamic = "force-dynamic";

export default async function EvalsPage() {
  let personas: { id: string; name: string }[] = [];
  try { personas = await prisma.persona.findMany({ select: { id: true, name: true } }); } catch {}
  const cases = EVAL_CASES.map((c) => ({ id: c.id, name: c.name, scenario: c.scenario, callGoal: c.callGoal, expected: c.expected.disposition }));
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
        <strong>Agent eval suite.</strong> 28 scripted scenarios (happy paths, disputes, hardship, hostility, DND,
        wrong-number, tone ladder, language switch…) run through the real Saaras→Gemini→Bulbul agent, then an LLM judge
        classifies the disposition and compares to ground truth. Pin a persona to score it against the whole suite.
      </div>
      <EvalRunner cases={cases} personas={personas} />
    </div>
  );
}
