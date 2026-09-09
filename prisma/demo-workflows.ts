import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma";
import { currentPolicy } from "../src/server/policy-acceptance";
import { monthKey } from "../src/lib/service-hours";
import { seedId } from "./demo-support";

/** Examples of modern workflows supplement the historical reporting fixtures. All data
 * is synthetic. Upserts use stable keys so a second seed does not create duplicate queues. */
export async function seedModernWorkflows(
  db: PrismaClient,
  passwordHash: string,
) {
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const termId = seedId("term-2026-q1");
  const headId = seedId("user-admin");
  const studentPolicy = await currentPolicy(db, "tutee-policy");
  const tutorPolicy = await currentPolicy(db, "tutor-policy");
  const accept = async (
    userId: string,
    signature: string,
    policy: typeof studentPolicy,
  ) => {
    await db.policyAcceptance.upsert({
      where: {
        userId_slug_revision: {
          userId,
          slug: policy.slug,
          revision: policy.revision,
        },
      },
      update: {},
      create: {
        id: seedId(`acceptance-${userId}-${policy.slug}-${policy.revision}`),
        userId,
        slug: policy.slug,
        revision: policy.revision,
        snapshot: policy.documents,
        signature,
        acceptedAt: ago(14),
      },
    });
  };

  for (const [key, name, role, translate] of [
    ["manager", "Morgan Administrator", "ADMIN", false],
    ["translator", "Taylor Translator", "VIEWER", true],
  ] as const) {
    const data = {
      name,
      role,
      canTranslate: translate,
      passwordHash,
      username: key,
      emailVerifiedAt: ago(20),
    };
    await db.user.upsert({
      where: { email: `${key}@example.test` },
      update: data,
      create: {
        id: seedId(`user-${key}`),
        email: `${key}@example.test`,
        ...data,
      },
    });
  }
  for (const user of await db.user.findMany({
    where: { tutorId: { not: null } },
  })) {
    await accept(user.id, user.name ?? "Demo tutor", tutorPolicy);
  }

  for (const [key, name] of [
    ["emma", "Emma Sun"],
    ["frank", "Frank Wu"],
    ["grace", "Grace Lin"],
    ["pending-kate", "Kate Park"],
  ] as const) {
    const studentId = seedId(`tutee-${key}`);
    const username = key === "pending-kate" ? "kate" : key;
    const email = `${username}@example.test`;
    const userId = seedId(`student-user-${key}`);
    await db.user.upsert({
      where: { email },
      update: { studentId, passwordHash, emailVerifiedAt: ago(10) },
      create: {
        id: userId,
        email,
        username,
        name,
        role: "STUDENT",
        studentId,
        passwordHash,
        emailVerifiedAt: ago(10),
      },
    });
    await db.studentProfileOwnership.upsert({
      where: { tuteeId: studentId },
      update: {},
      create: { tuteeId: studentId, userId },
    });
    await db.tutee.update({
      where: { id: studentId },
      data: { email, intakeTermId: termId },
    });
    await accept(userId, name, studentPolicy);
    const tutee = await db.tutee.findUniqueOrThrow({
      where: { id: studentId },
    });
    const slots =
      key === "pending-kate"
        ? [seedId("slot-tue-a"), seedId("slot-thu-a")]
        : [seedId(key === "grace" ? "slot-wed-a" : "slot-mon-a")];
    for (const slotId of slots)
      await db.tuteeAvailability.upsert({
        where: { tuteeId_slotId: { tuteeId: studentId, slotId } },
        update: {},
        create: { tuteeId: studentId, slotId },
      });
    const payload = {
      englishName: name,
      email,
      gradeLevel: tutee.gradeLevel ?? "10",
      preferredContact: "Use the program inbox",
      firstChoiceId: tutee.firstChoiceId!,
      ...(tutee.secondChoiceId ? { secondChoiceId: tutee.secondChoiceId } : {}),
      slotIds: slots,
      signatureName: name,
      agreed: true,
      policyRevision: studentPolicy.revision,
    };
    const data = {
      email,
      intakeTermId: termId,
      payload,
      policyRevision: studentPolicy.revision,
      policySnapshot: studentPolicy.documents,
      submittedAt: ago(12),
      confirmedAt: ago(10),
      tuteeId: studentId,
      firstAssignedAt: key === "pending-kate" ? null : ago(9),
      verificationDueAt: key === "pending-kate" ? null : ago(2),
      expiresAt: ago(9),
      state: "OPEN" as const,
    };
    await db.studentSurvey.upsert({
      where: { id: seedId(`survey-${key}`) },
      update: {},
      create: {
        id: seedId(`survey-${key}`),
        tokenHash: randomBytes(32).toString("hex"),
        ...data,
      },
    });
  }

  // Unverified demand exists before a Tutee/User: the collective queue must count it.
  for (const [key, name, state] of [
    ["waiting", "Willow Waiting", "OPEN"],
    ["recalled", "Robin Recalled", "RECALLED"],
    ["withdrawn", "Wren Withdrawn", "ABORTED"],
    ["expired", "Ellis Expired", "DISQUALIFIED"],
  ] as const) {
    const email = `${key}@example.test`;
    const tuteeId = state === "OPEN" ? null : seedId(`tutee-${key}`);
    const userId = seedId(`student-user-${key}`);
    if (tuteeId) {
      await db.tutee.upsert({
        where: { id: tuteeId },
        update: {},
        create: {
          id: tuteeId,
          englishName: name,
          email,
          gradeLevel: "10",
          status: "INACTIVE",
          intakeTermId: termId,
          firstChoiceId: seedId("course-math"),
        },
      });
      if (state !== "DISQUALIFIED") {
        await db.user.upsert({
          where: { email },
          update: { passwordHash },
          create: {
            id: userId,
            email,
            username: key,
            name,
            role: "STUDENT",
            studentId: tuteeId,
            passwordHash,
            emailVerifiedAt: ago(9),
          },
        });
        await db.studentProfileOwnership.upsert({
          where: { tuteeId },
          update: {},
          create: { tuteeId, userId },
        });
        await accept(userId, name, studentPolicy);
      }
    }
    const assigned = state === "ABORTED" || state === "DISQUALIFIED";
    const data = {
      email,
      intakeTermId: termId,
      state,
      tuteeId,
      submittedAt: ago(state === "OPEN" ? 2 : 11),
      expiresAt: ago(-1),
      confirmedAt: state === "RECALLED" || state === "ABORTED" ? ago(9) : null,
      firstAssignedAt: assigned ? ago(8) : null,
      verificationDueAt: assigned ? ago(1) : null,
      policyRevision: studentPolicy.revision,
      policySnapshot: studentPolicy.documents,
      resolvedAt: state === "OPEN" ? null : ago(1),
      payload: {
        englishName: name,
        email,
        preferredContact: "Email",
        gradeLevel: "10",
        firstChoiceId: seedId("course-math"),
        slotIds: [seedId("slot-wed-a")],
        signatureName: name,
        agreed: true,
        policyRevision: studentPolicy.revision,
      },
    };
    await db.studentSurvey.upsert({
      where: { id: seedId(`survey-${key}`) },
      update: {},
      create: {
        id: seedId(`survey-${key}`),
        tokenHash: randomBytes(32).toString("hex"),
        ...data,
      },
    });
    if (state === "ABORTED")
      await db.studentQuarterBlock.upsert({
        where: { email_intakeTermId: { email, intakeTermId: termId } },
        update: {},
        create: {
          id: seedId("quarter-block-withdrawn"),
          email,
          intakeTermId: termId,
          surveyId: seedId(`survey-${key}`),
          userId,
        },
      });
    if (state === "ABORTED")
      await db.studentRequestReview.upsert({
        where: { id: seedId("review-withdrawn") },
        update: {},
        create: {
          id: seedId("review-withdrawn"),
          surveyId: seedId(`survey-${key}`),
          requestedByUserId: userId,
          kind: "STUDENT_ABORT",
          reason: "Completed demonstration of approved quarter withdrawal.",
          state: "APPROVED",
          createdAt: ago(2),
          resolvedAt: ago(1),
          resolvedByUserId: headId,
        },
      });
  }
  await db.studentSettings.upsert({
    where: { id: "program" },
    update: {},
    create: { id: "program", shareFeedbackWithTutors: false },
  });
  await db.studentFeedback.upsert({
    where: {
      studentId_sessionId: {
        studentId: seedId("tutee-emma"),
        sessionId: seedId("sess-alice-1"),
      },
    },
    update: {},
    create: {
      id: seedId("feedback-emma"),
      studentId: seedId("tutee-emma"),
      sessionId: seedId("sess-alice-1"),
      rating: 5,
      body: "Working through examples helped me solve the next problem independently.",
    },
  });
  await db.disciplinaryCard.update({
    where: { id: seedId("card-frank-y1") },
    data: { createdAt: ago(1) },
  });
  await db.studentAppeal.upsert({
    where: { cardId: seedId("card-frank-y1") },
    update: {},
    create: {
      id: seedId("student-appeal-frank"),
      studentId: seedId("tutee-frank"),
      cardId: seedId("card-frank-y1"),
      body: "My teacher confirmed that the mandatory lab ran late. Please review this card.",
    },
  });
  for (const [key, kind, pairing] of [
    ["frank", "STUDENT_ABORT", "pairing-alice-math"],
    ["grace", "SCHEDULE_CONFLICT", "pairing-bob-physics"],
  ] as const) {
    await db.studentRequestReview.upsert({
      where: { id: seedId(`review-${key}`) },
      update: {},
      create: {
        id: seedId(`review-${key}`),
        surveyId: seedId(`survey-${key}`),
        kind,
        requestedByUserId:
          key === "frank" ? seedId("student-user-frank") : seedId("user-bob"),
        pairingId: seedId(pairing),
        reason:
          "A new required class conflicts with this tutoring schedule. Please review the next step.",
      },
    });
  }
  await db.directMessage.upsert({
    where: {
      senderId_clientKey: {
        senderId: seedId("student-user-emma"),
        clientKey: "024669d6-750a-4a35-9ce4-62b4f55f9ed3",
      },
    },
    update: {},
    create: {
      id: seedId("message-emma"),
      senderId: seedId("student-user-emma"),
      recipientId: headId,
      clientKey: "024669d6-750a-4a35-9ce4-62b4f55f9ed3",
      body: "Where can I see my session feedback and upcoming assignments?",
    },
  });
  await db.translationDraft.upsert({
    where: { id: seedId("translation-draft-demo") },
    update: {},
    create: {
      id: seedId("translation-draft-demo"),
      authorId: seedId("user-translator"),
      operation: "localization.setString",
      payload: { locale: "en", key: "common.save", value: "Save changes" },
    },
  });
  await db.schoolCalendarDay.upsert({
    where: { date: ago(-2).toISOString().slice(0, 10) },
    update: {},
    create: {
      date: ago(-2).toISOString().slice(0, 10),
      isSchoolDay: false,
      note: "Synthetic school closure for appeal deadline demonstration",
    },
  });

  // Existing two-person, tutor-chaired examples predate current panel rules. Rebuild each
  // panel with a coordinator chair, explicit qualifications, and complete voting evidence.
  for (const key of ["fiona", "george", "hana"] as const) {
    const applicationId = seedId(`app-${key}`);
    const members =
      key === "hana"
        ? ["carol", "iris", "jason", "alice"]
        : ["carol", "alice", "bob"];
    await db.interviewAssignment.deleteMany({ where: { applicationId } });
    await db.interviewVote.deleteMany({ where: { applicationId } });
    const intents = await db.applicationSubjectIntent.findMany({
      where: { applicationId },
    });
    for (const [index, member] of members.entries()) {
      const tutorId = seedId(`tutor-${member}`);
      await db.interviewAssignment.create({
        data: { applicationId, tutorId, isHead: index === 0, attended: true },
      });
      await db.interviewVote.create({
        data: {
          applicationId,
          tutorId,
          accept: key !== "hana" || index >= 2,
          comment:
            "Synthetic panel evidence: subject explanation and communication reviewed.",
        },
      });
      const credit = {
        tutorId,
        month: monthKey(ago(4)),
        schoolYear: "26-27",
        quarter: "Q1" as const,
        type: "EXTRA" as const,
        amount: 35 / 60,
        reason: "Completed interview service",
      };
      await db.serviceHourAdjustment.upsert({
        where: { id: `interview_${applicationId}_${tutorId}` },
        update: credit,
        create: { id: `interview_${applicationId}_${tutorId}`, ...credit },
      });
      for (const intent of intents)
        await db.tutorQualification.upsert({
          where: {
            tutorId_subjectId: { tutorId, subjectId: intent.subjectId },
          },
          update: {},
          create: {
            tutorId,
            subjectId: intent.subjectId,
            approvedById: headId,
          },
        });
    }
    await db.tutorApplication.update({
      where: { id: applicationId },
      data: {
        interviewAt: ago(4),
        interviewCompletedAt: ago(4),
        interviewDurationMin: 35,
        interviewSchoolYear: "26-27",
        interviewQuarter: "Q1",
        ...(key === "fiona"
          ? {}
          : { decidedByTutorId: seedId("tutor-carol"), decidedAt: ago(3) }),
      },
    });
  }
  // Qualifications also make the regular assignment choices useful to coordinators.
  for (const pairing of await db.pairing.findMany({ where: { termId } })) {
    const subject = await db.subject.findFirst({
      where: { name: pairing.subject },
    });
    if (subject)
      await db.tutorQualification.upsert({
        where: {
          tutorId_subjectId: {
            tutorId: pairing.tutorId,
            subjectId: subject.id,
          },
        },
        update: {},
        create: {
          tutorId: pairing.tutorId,
          subjectId: subject.id,
          approvedById: headId,
        },
      });
  }
  await db.tutorMeeting.upsert({
    where: { id: seedId("meeting-upcoming") },
    update: { date: ago(-3) },
    create: {
      id: seedId("meeting-upcoming"),
      title: "Upcoming tutor briefing — practice an advance excuse",
      date: ago(-3),
      termId,
    },
  });
}
