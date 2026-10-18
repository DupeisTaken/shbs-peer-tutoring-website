type InterviewOrder = {
  id: string;
  status: string;
  isInvalid: boolean;
  interviewAt: Date | null;
  decidedAt?: Date | null;
  updatedAt: Date;
};

/** Only an applied terminal outcome closes work. Completion and queued votes do not. */
export function isOpenInterview(interview: Pick<InterviewOrder, "status">) {
  return interview.status === "PENDING" || interview.status === "INTERVIEW";
}

/** Copy before sorting: React Query's shared result must retain its original identity/order. */
export function orderInterviews<T extends InterviewOrder>(
  interviews: readonly T[],
): T[] {
  const group = (row: T) =>
    isOpenInterview(row) ? (row.isInvalid ? 1 : 0) : 2;
  return [...interviews].sort((a, b) => {
    const groupDifference = group(a) - group(b);
    if (groupDifference) return groupDifference;
    if (isOpenInterview(a)) {
      const left = a.interviewAt?.getTime() ?? Infinity;
      const right = b.interviewAt?.getTime() ?? Infinity;
      if (left !== right) return left < right ? -1 : 1;
    } else {
      const difference =
        (b.decidedAt ?? b.updatedAt).getTime() -
        (a.decidedAt ?? a.updatedAt).getTime();
      if (difference) return difference;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
