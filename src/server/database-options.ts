import { createHash } from "node:crypto";

/** Only the fixed publication statement is named. pg retains its prepared
 * statement per connection, never result rows or participant/calendar facts.
 * Hash the complete SQL so changed deployments cannot reuse an old statement
 * name for different SQL; bound values never enter the name. Other SQL keeps
 * pg's existing unnamed behavior instead of accumulating arbitrary shapes.
 */
export const schedulingPgOptions = {
  statementNameGenerator(query: { sql: string }): string {
    if (
      !/^\s*WITH\s+\/\* shbs:publication-validation \*\/\s+parameters\s+AS\b/i.test(
        query.sql,
      )
    )
      return "";
    return `shbs_pub_${createHash("sha256").update(query.sql).digest("hex").slice(0, 40)}`;
  },
};
