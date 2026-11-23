import { renderEmailQuotaCard } from "../email-quota-card";
import ProgramSettings from "./program-settings";

export default async function ProgramPage() {
  return <ProgramSettings deliveryQuota={await renderEmailQuotaCard("h3")} />;
}
