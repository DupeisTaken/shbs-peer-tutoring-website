/** Reviewed PostgreSQL recovery metadata contract. New schema needs explicit review.
 * This static catalog is intentionally not read from Prisma at runtime: matching
 * two unreviewed databases must never authorize an unknown bearer/grant surface. */
import { operatorAssert } from "./operator-cli";

const REVIEWED_COLUMNS = `
AcademicConfirmation|actorId:text,confirmedAt:timestamp,gradeLevel:int4,id:text,rawGrade:text,reason:text,schoolYear:text,source:text,status:AcademicStatus,userId:text
AcademicProfile|confirmedAt:timestamp,gradeLevel:int4,rawGrade:text,reconfirmRequired:bool,schoolYear:text,status:AcademicStatus,userId:text
AccountAppeal|createdAt:timestamp,decidedAt:timestamp,decidedByName:text,id:text,message:text,state:AppealState,userId:text
AccountEmail|createdAt:timestamp,email:text,userId:text,verifiedAt:timestamp
AccountInvitation|accountId:text,attempts:int4,codeHash:text,completedAt:timestamp,completedUserId:text,createdAt:timestamp,displayCodeNonce:int4,displayedCode:bool,email:text,emailCodeExpiresAt:timestamp,emailCodeHash:text,expiresAt:timestamp,id:text,kind:text,loginUsedAt:timestamp,receipt:jsonb,sessionVersion:int4,source:jsonb,sourceKey:text,verifiedAt:timestamp
Announcement|active:bool,audienceRestricted:bool,body:text,createdAt:timestamp,createdById:text,id:text,pinned:bool,recipientTutorIds:_text,title:text
AnnouncementAck|ackedAt:timestamp,announcementId:text,userId:text
ApplicationIdentityCorrection|actorId:text,actorName:text,after:jsonb,applicationId:text,appliedUpdatedAt:timestamp,approvalId:text,before:jsonb,clientKey:uuid,createdAt:timestamp,id:text,inputHash:text,policy:jsonb,reason:text,receiptOwner:text,revision:int4
ApplicationIdentityOriginal|applicationId:text,original:jsonb,submittedAt:timestamp
ApplicationSubjectIntent|applicationId:text,apScore:text,grade:text,hasApScore:bool,id:text,selfStudied:bool,selfStudyNote:text,subjectId:text,taken:bool
ApprovalRequest|createdAt:timestamp,fingerprint:text,id:text,operation:text,payload:jsonb,requesterId:text,requesterName:text,reviewedAt:timestamp,reviewerId:text,reviewerName:text,reviewNote:text,state:ApprovalStatus,targets:jsonb
AuditLog|action:text,approvalId:text,createdAt:timestamp,details:jsonb,entity:text,entityId:text,id:text,kind:text,operation:text,undoData:jsonb,undone:bool,undoneAt:timestamp,userId:text,userName:text
CaptchaGrant|action:text,expiresAt:timestamp,identityHash:text,scene:text,tokenHash:text,version:int4
CaptchaProof|expiresAt:timestamp,key:text
CourseGroup|createdAt:timestamp,id:text,name:text,rank:int4
CrewApplication|alternativeNames:text,createdAt:timestamp,decidedAt:timestamp,decidedByName:text,decisionComment:text,email:text,firstName:text,gradeLevel:int4,id:text,lastName:text,message:text,name:text,preferredContact:text,preferredName:text,status:CrewApplicationStatus
CrewSignupVerification|applicationId:text,attempts:int4,codeExpiresAt:timestamp,codeHash:text,createdAt:timestamp,draft:jsonb,email:text,id:text,verifiedAt:timestamp
CrewStatusRequest|createdAt:timestamp,decidedAt:timestamp,decidedByName:text,eligibleAt:timestamp,id:text,kind:CrewRequestKind,reason:text,state:CrewRequestState,userId:text
CustomPage|createdAt:timestamp,createdByName:text,id:text,navOrder:int4,published:bool,showInNav:bool,slug:text,title:jsonb,updatedAt:timestamp
DirectMessage|body:text,clientKey:text,createdAt:timestamp,hiddenAt:timestamp,id:text,readAt:timestamp,recipientId:text,senderId:text,supervisable:bool
DisciplinaryCard|color:CardColor,createdAt:timestamp,id:text,issuedByTutorId:text,reason:text,reviewedAt:timestamp,reviewedById:text,reviewNote:text,reviewStatus:CardReviewStatus,sessionId:text,source:CardSource,tuteeId:text,updatedAt:timestamp
EmailDelivery|attemptId:text,attempts:int4,attemptStartedAt:timestamp,availableAt:timestamp,category:text,completedAt:timestamp,context:jsonb,createdAt:timestamp,destination:text,event:text,id:text,lastError:text,leaseUntil:timestamp,monthlyHoursReportId:text,preferenceTopic:text,previousPrimary:bool,recipient:text,reminderKey:text,requestId:text,requestInvalid:bool,requestKind:text,requestReason:text,requestSubmittedAt:timestamp,requestTimeZone:text,requestVersion:int4,schoolHoursReportId:text,status:text,userId:text
EmailVerificationCode|attempts:int4,codeHash:text,consumedAt:timestamp,createdAt:timestamp,expiresAt:timestamp,id:text,purpose:VerificationPurpose,targetEmail:text,userId:text
HistoricalAcademicCorrection|actorId:text,actorName:text,approvalId:text,before:jsonb,correctedAt:timestamp,evidence:text,id:text,method:text,rawGrade:text,reason:text,recordId:text,revision:int4,schoolYear:text
HistoricalAcademicRecord|academicallyGraduated:bool,id:text,originalConfirmedAt:timestamp,rawGrade:text,recordedAt:timestamp,schoolYear:text,source:text,tuteeId:text,tutorId:text
HistoricalRecordClaimReceipt|claimedAt:timestamp,email:text,expiresAt:timestamp,sessionVersion:int4,sources:jsonb,tokenHash:text,userId:text
HistoricalRecordInvitation|claimedAt:timestamp,claimedUserId:text,createdAt:timestamp,email:text,expiresAt:timestamp,issuedById:text,issuedBySessionVersion:int4,reason:text,recipientFingerprint:text,recipientId:text,recipientSessionVersion:int4,scopeFingerprint:text,scopeKey:text,setupAttempts:int4,setupCodeExpiresAt:timestamp,setupCodeHash:text,setupUserId:text,setupVerifiedAt:timestamp,sources:jsonb,tokenHash:text
HistoricalRecordInvitationAttempt|createdAt:timestamp,email:text,expiresAt:timestamp,id:text,inputHash:text,issuedById:text,issuedBySessionVersion:int4,predecessorFingerprint:text,reason:text,recipientFingerprint:text,recipientId:text,recipientSessionVersion:int4,scopeFingerprint:text,scopeKey:text,sequence:int4,settledAt:timestamp,sources:jsonb,status:TuteeHistoryInvitationAttemptStatus,tokenHash:text
HomeContent|key:text,locale:text,updatedAt:timestamp,updatedByName:text,value:text
HomeImage|alt:text,byteSize:int4,createdAt:timestamp,createdByName:text,data:bytea,id:text,mimeType:text
InterviewAssignment|applicationId:text,attended:bool,createdAt:timestamp,isHead:bool,tutorId:text
InterviewVote|accept:bool,applicationId:text,comment:text,createdAt:timestamp,tutorId:text
LandingSection|createdAt:timestamp,createdByName:text,id:text,mode:SectionMode,openByDefault:bool,published:bool,slug:text,sortOrder:int4,updatedAt:timestamp
LandingSectionTranslation|body:text,id:text,locale:text,sectionId:text,title:text
Language|builtIn:bool,code:text,createdAt:timestamp,enabled:bool,label:text,sortOrder:int4
MeetingAttendance|excusedAt:timestamp,id:text,meetingId:text,reason:text,status:MeetingAttendanceStatus,tutorId:text
MessageBatch|clientKey:text,count:int4,createdAt:timestamp,payloadHash:text,senderId:text
MessageModeration|action:text,actorId:text,createdAt:timestamp,id:text,messageId:text,reason:text,targetUserId:text
MessageOverride|id:text,key:text,locale:text,updatedAt:timestamp,updatedByName:text,value:text
MessagePermission|groups:_text,scope:text,updatedAt:timestamp
MessageRestriction|restricted:bool,updatedAt:timestamp,userId:text
MessageTutorAssignment|recordedAt:timestamp,source:text,tuteeId:text,tutorId:text
MonthlyHoursReport|configVersion:int4,contentHash:text,dueAt:timestamp,generatedAt:timestamp,generatedById:text,generationHash:text,generationKey:text,id:text,intendedRecipients:jsonb,month:text,reason:text,revision:int4,scheduleId:text,snapshot:jsonb,timeZone:text
MonthlyHoursSchedule|dayOfMonth:int4,enabled:bool,firstReportMonth:text,id:text,lastGenerationError:text,localTime:text,nextDueAt:timestamp,nextReportMonth:text,recipientUserIds:_text,timeZone:text,updatedAt:timestamp,version:int4
NewsPost|createdAt:timestamp,createdByName:text,id:text,pinned:bool,publishedAt:timestamp,status:NewsStatus,updatedAt:timestamp
NewsTranslation|body:text,id:text,locale:text,postId:text,title:text
NextRecruitmentPreparation|audience:RecruitmentAudience,createdAt:timestamp,createdById:text,destinationQuarter:Quarter,destinationSchoolYear:text,modeRevision:int4,opensAt:timestamp,semesterMode:bool,sourceQuarter:Quarter,sourceSchoolYear:text,sourceTermId:text,timeZone:text,updatedAt:timestamp,updatedById:text,updatedByName:text,version:int4
Notification|body:text,category:text,context:jsonb,createdAt:timestamp,event:text,id:text,inAppOnly:bool,link:text,readAt:timestamp,recoveryWithdrawnAt:timestamp,title:text,userId:text
NotificationPreference|badgeEnabled:bool,category:text,emailEnabled:bool,userId:text
PageLayout|blocks:jsonb,ownerKey:text,updatedAt:timestamp,updatedByName:text
Pairing|createdAt:timestamp,dayOfWeek:int4,endMin:int4,groupId:text,id:text,roomId:text,roomMode:PairingRoomMode,roomNeedsAssignment:bool,roomShortageKey:text,roomVersion:int4,scheduleConfirmed:bool,startMin:int4,subject:text,termId:text,timeSlotId:text,tutorId:text
PairingCreationRequest|actorId:text,clientKey:text,createdAt:timestamp,pairingId:text,payloadHash:text
PairingGroup|createdAt:timestamp,id:text,primaryPairingId:text,termId:text,tutorId:text,updatedAt:timestamp
PairingTutee|pairingId:text,tuteeId:text
PasswordResetToken|consumedAt:timestamp,createdAt:timestamp,expiresAt:timestamp,id:text,targetEmail:text,tokenHash:text,userId:text
Patrol|createdAt:timestamp,creditAwardedAt:timestamp,crewUserId:text,hours:float8,id:text,note:text,submissionKey:text,submissionPayloadHash:text,termId:text,updatedAt:timestamp
PatrolCreditWindow|crewUserId:text,patrolId:text,windowStart:timestamp
PatrolObservation|headcount:Headcount,id:text,observedAt:timestamp,patrolId:text,roomId:text
Person|createdAt:timestamp,id:text,mergedIntoId:text,primaryUserId:text,resolutionState:PersonResolutionState,revision:int4,updatedAt:timestamp
PersonCombineReceipt|actorId:text,createdAt:timestamp,id:text,inputHash:text,outcome:PersonResolutionState,personId:text,retiredUserIds:_text
PolicyAcceptance|acceptedAt:timestamp,id:text,revision:text,signature:text,slug:text,snapshot:jsonb,userId:text
PolicyArchive|archivedAt:timestamp,archivedByName:text,body:text,id:text,locale:text,slug:text,title:text,version:text
PolicyDocument|body:text,id:text,locale:text,slug:text,title:text,updatedAt:timestamp,updatedById:text,version:text
PolicyFile|id:text,name:text,path:text,uploadedAt:timestamp
ProgramCalendarDay|active:bool,date:text,endDate:text,reason:text,schedulingEffect:text,updatedAt:timestamp,version:int4
ProgramCalendarPolicyRevision|active:bool,date:text,effectiveAt:timestamp,endDate:text,id:int8,schedulingEffect:text,version:int4
ProgramFeature|enabled:bool,key:ProgramFeatureKey,pendingEnabled:bool,revision:int4,updatedAt:timestamp,updatedByName:text
ProgramSettings|captchaEnabled:bool,captchaVersion:int4,emailNotificationsEnabled:bool,id:text,nameFields:jsonb,nameFieldsVersion:int4,offeredGrades:_int4,requireLatinLegalNames:bool,requireLatinNames:bool,secondaryEmailBindingEnabled:bool,showAlternateNames:bool,signupFields:jsonb,timeZone:text,updatedAt:timestamp,usePreferredNames:bool
PublicApplicationRateLimit|count:int4,key:text,resetsAt:timestamp
QualificationGrant|grantedAt:timestamp,sourceSubjectId:text,subjectId:text,tutorId:text
RecoveryAction|after:jsonb,applicationId:text,before:jsonb,createdAt:timestamp,id:text,kind:text
RecoveryChange|actionId:text,after:jsonb,before:jsonb,changedFields:jsonb,createdAt:timestamp,entity:text,eventId:text,id:int8,operation:text,recordKey:jsonb
RecoveryCheckpoint|actionId:text,adapter:text,adapterVersion:int4,capturedById:text,captureTransactionId:text,createdAt:timestamp,id:text,schemaVersion:int4,scope:jsonb,sourceEntity:text,sourceId:text
RecoveryDeliveryCancellation|createdAt:timestamp,disposition:text,effectId:text,recoveryKey:text
RecoveryDeliveryCoverage|actionId:text,createdAt:timestamp,eventId:text,version:int4
RecoveryDeliveryEffect|actionId:text,createdAt:timestamp,deliveryId:text,eventId:text,id:text,notificationId:text
RecoveryEvent|actionId:text,createdAt:timestamp,id:text,kind:text,payload:jsonb,transactionId:text
RecoveryFence|actionId:text,revision:int4
RecoveryReceipt|actionId:text,actorId:text,channel:text,clientKey:uuid,createdAt:timestamp,evidence:jsonb,fingerprint:text,id:text,inputHash:text,reason:text
RecoveryTrackedEntity|actionId:text,entity:text,recordId:text
RecoveryWorkflowDraft|actionId:text,answers:jsonb,consumedAt:timestamp,createdAt:timestamp,id:text,ownerBindingHash:text,ownerUserId:text,sourceSurveyId:text,sourceTuteeId:text,state:text,submittedSurveyId:text,version:int4
RegistrationCode|applicationId:text,attempts:int4,code:text,createdAt:timestamp,crewApplicationId:text,email:text,emailCodeAttempts:int4,emailCodeExpiresAt:timestamp,emailCodeHash:text,emailVerifiedAt:timestamp,expiresAt:timestamp,id:text,issuedById:text,issuedByName:text,kind:RegistrationCodeKind,label:text,pendingEmail:text,tutorId:text,usedAt:timestamp,usedByUserId:text
RequestInvalidityAppeal|body:text,decisionReason:text,id:text,noticeId:text,resolvedAt:timestamp,reviewedById:text,reviewVersion:int4,status:text,submittedAt:timestamp
Room|createdAt:timestamp,id:text,name:text,patrolOrder:int4,programOrder:int4
RoomUnavailability|createdAt:timestamp,dayOfWeek:int4,endMin:int4,id:text,reason:text,roomId:text,startMin:int4
ScheduledProgramRefresh|attempts:int4,authorityRevision:int4,authorizedById:text,authorizedByName:text,blockedReason:text,completedAt:timestamp,createdAt:timestamp,destinationQuarter:Quarter,destinationSchoolYear:text,executeAt:timestamp,expectedPreparation:jsonb,id:text,semesterMode:bool,sourceQuarter:Quarter,sourceSchoolYear:text,sourceTermId:text,state:ScheduledRefreshState,timeZone:text,updatedAt:timestamp,version:int4
SchoolCalendarDay|active:bool,date:text,isSchoolDay:bool,note:text,scheduleRevision:int4,timetableWeekday:int4,updatedAt:timestamp,version:int4
SchoolDeparture|confirmedAt:timestamp,confirmedById:text,effectiveAt:timestamp,observerRevoked:bool,reason:text,revision:int4,source:text,tutorDerived:bool,userId:text
SchoolDepartureEvent|action:text,actorId:text,createdAt:timestamp,explanation:text,id:text,revision:int4,source:text,userId:text
SchoolHoursReport|baselineVersion:int4,configVersion:int4,contentHash:text,dueAt:timestamp,generatedAt:timestamp,generatedById:text,generationHash:text,generationKey:text,id:text,intendedRecipients:_text,linkRevokedAt:timestamp,linkTokenHash:text,linkVersion:int4,month:text,predecessorId:text,reason:text,revision:int4,scheduleId:text,snapshot:jsonb,sourceBaseline:jsonb,supersededById:text,supersedesId:text,timeZone:text
SchoolHoursSchedule|baselineVersion:int4,dateOverrides:jsonb,enabled:bool,headReportId:text,id:text,includeStatistics:bool,lastGenerationError:text,nextDueAt:timestamp,nextMonth:text,openingBaseline:jsonb,openingReviewedAt:timestamp,recipientEmails:_text,timeZone:text,updatedAt:timestamp,version:int4
ServiceHourAdjustment|amount:float8,createdAt:timestamp,id:text,month:text,quarter:Quarter,reason:text,schoolYear:text,tutorId:text,type:AdjustmentType
Session|actualRoomId:text,comments:text,createdAt:timestamp,date:timestamp,durationMin:int4,endMin:int4,id:text,mergeGroupId:text,month:text,online:bool,pairingId:text,planningCohortId:text,quarter:Quarter,ratingBehavior:int4,ratingParticipation:int4,ratingPreparedness:int4,ratingProgress:int4,ratingUnderstanding:int4,schoolYear:text,shCount:float8,shFactor:int4,startMin:int4,submissionKey:text,submissionPayloadHash:text,timeSlotId:text,tutorAbsentReason:text,tutorId:text,tutorStatus:SessionTutorStatus,updatedAt:timestamp
SessionCalendarToken|createdAt:timestamp,id:text,revokedAt:timestamp,tokenHash:text,userId:text
SessionFlag|createdAt:timestamp,decisionNote:text,expected:int4,id:text,observed:int4,resolvedAt:timestamp,resolvedById:text,resolvedByName:text,sessionId:text,state:SessionFlagState,tutorId:text
SessionNotice|acceptedAt:timestamp,attemptId:text,attempts:int4,attemptStartedAt:timestamp,availableAt:timestamp,completedAt:timestamp,context:jsonb,createdAt:timestamp,dedupeKey:text,event:text,id:text,lastError:text,leaseUntil:timestamp,offerId:text,priority:int4,recipientEmail:text,recipientUserId:text,requestId:text,responseId:text,status:text,updatedAt:timestamp
SessionPlan|createdAt:timestamp,generationKey:text,id:text,kind:text,originalDate:text,sourceFingerprint:text,sourceScheduleFingerprint:text,termId:text,timeZone:text,tutorId:text,updatedAt:timestamp
SessionPlanAssignment|pairingId:text,planId:text,primary:bool,subject:text,tuteeIds:jsonb
SessionPlanCohort|createdAt:timestamp,date:text,endMin:int4,endsAt:timestamp,id:text,online:bool,planId:text,rescheduled:bool,roomId:text,sourceInvalidated:bool,startMin:int4,startsAt:timestamp,status:text,updatedAt:timestamp,version:int4
SchedulingDirtyEvent|createdAt:timestamp,id:int8,publicationPending:bool,requestId:text,settlementPending:bool,sourceTable:text
SchedulingMaintenanceState|id:text,normalized:int4,prepareEnd:text,publicationVersion:int4,settlementBatchActive:bool,settlementBatchExhausted:bool,settlementCursor:text,settlementEventIds:_int8,settlementRequestIds:_text,settlementVersion:int4,timeZone:text,unavailable:int4,updatedAt:timestamp,windowStart:text
SessionPlanContinuationMember|assignmentId:text,joinedAt:timestamp,pairingId:text,planId:text,releasedAt:timestamp,sourceSurveyId:text,tuteeId:text
SessionPlanningOffer|authorKey:text,createdAt:timestamp,cutoffAt:timestamp,date:text,endMin:int4,endsAt:timestamp,id:text,online:bool,requestId:text,roomId:text,sequence:int4,startMin:int4,startsAt:timestamp
SessionPlanningReceipt|actorId:text,clientKey:text,createdAt:timestamp,payloadHash:text,result:jsonb
SessionPlanningRequest|cohortId:text,createdAt:timestamp,currentOfferId:text,id:text,kind:text,parentRequestId:text,participantIds:jsonb,planId:text,rejectionKeys:jsonb,scope:text,stage:int4,status:text,updatedAt:timestamp,version:int4
SessionPlanningResponse|acceptedBy:text,actorKey:text,actorUserId:text,deadline:timestamp,deliveredAt:timestamp,id:text,offerId:text,respondedAt:timestamp,state:text
SessionPlanningSuggestion|actorUserId:text,cohortId:text,createdAt:timestamp,date:text,id:text,online:bool,planId:text,roomId:text,sourceVersion:int4,startMin:int4,tuteeId:text,usedAt:timestamp,version:int4
SessionPlanParticipant|calendarSuppressed:bool,cohortId:text,id:text,planId:text,scheduleOverride:bool,status:text,tuteeId:text,tutoringPauseSuppressed:bool,updatedAt:timestamp,version:int4
SessionTutee|absenceReason:text,sessionId:text,status:TuteeAttendanceStatus,tuteeId:text
SignupLease|expiresAt:timestamp,owner:text,slot:text
SignupQuota|count:int4,expiresAt:timestamp,key:text
StudentActionConfirmation|action:text,expiresAt:timestamp,id:text,readyAt:timestamp,target:text,usedAt:timestamp,userId:text
StudentAppeal|body:text,cardId:text,createdAt:timestamp,decidedById:text,decision:text,id:text,state:text,studentId:text,updatedAt:timestamp
StudentContinuationAssignment|assignedAt:timestamp,createdAt:timestamp,id:text,reason:text,releasedAt:timestamp,snapshot:jsonb,sourcePairingId:text,sourceTuteeId:text,status:text,surveyId:text,targetPairingId:text,targetTermId:text,tuteeId:text,tutorId:text
StudentContinuationPairing|createdAt:timestamp,pairingId:text,sourcePairingId:text,targetTermId:text
StudentContinuationReceipt|clientKey:uuid,createdAt:timestamp,inputHash:text,result:jsonb,surveyId:text,userId:text
StudentFeedback|body:text,id:text,rating:int4,sessionId:text,studentId:text,updatedAt:timestamp
StudentProfileOwnership|revision:int4,tuteeId:text,userId:text
StudentQuarterBlock|createdAt:timestamp,email:text,id:text,intakeTermId:text,legacyTuteeId:text,surveyId:text,userId:text
StudentRequestReview|createdAt:timestamp,id:text,kind:StudentReviewKind,legacyIntakeTermId:text,legacyTuteeId:text,pairingId:text,reason:text,requestedByUserId:text,resolvedAt:timestamp,resolvedByUserId:text,state:TuteeRequestState,surveyId:text
StudentSettings|id:text,shareFeedbackWithTutors:bool
StudentSignup|attempts:int4,codeHash:text,email:text,expiresAt:timestamp,name:text,usedAt:timestamp
StudentSignupAppeal|actorUserId:text,clientKey:uuid,createdAt:timestamp,decisionHash:text,decisionKey:uuid,id:text,inputHash:text,invalidityVersion:int4,reason:text,resolvedAt:timestamp,resolvedByUserId:text,state:StudentSignupAppealState,surveyId:text
StudentSignupIntent|accountId:text,attempts:int4,completedAt:timestamp,completedUserId:text,email:text,emailCodeVersion:int4,emailSentAt:timestamp,expectedVersion:int4,expiresAt:timestamp,id:text,inputHash:text,keyHash:text,payload:jsonb,policySnapshot:jsonb,receivedAt:timestamp,resultVersion:int4,sessionVersion:int4,submittedByUserId:text,surveyId:text,tokenHash:text,verifiedAt:timestamp
StudentSignupNotice|accountId:text,attempts:int4,createdAt:timestamp,id:text,invalidityVersion:int4,kind:text,lastAttemptAt:timestamp,recipientEmail:text,sentAt:timestamp,sessionVersion:int4,state:text,surveyId:text,tokenHash:text
StudentSignupRevision|actorUserId:text,actorUserName:text,answers:jsonb,clientKey:uuid,createdAt:timestamp,expectedVersion:int4,id:text,inputHash:text,policyAcceptedAt:timestamp,policyRevision:text,policySnapshot:jsonb,signatureName:text,surveyId:text,version:int4
StudentSurvey|confirmedAt:timestamp,currentPayload:jsonb,currentVersion:int4,editedAt:timestamp,email:text,emailCodeVersion:int4,expiresAt:timestamp,firstAssignedAt:timestamp,id:text,intakeTermId:text,invalidatedAt:timestamp,invalidatedById:text,invalidatedByName:text,invalidityVersion:int4,invalidReason:text,lastLinkSentAt:timestamp,payload:jsonb,policyRevision:text,policySnapshot:jsonb,publicSignupEmailConfirmedAt:timestamp,resolvedAt:timestamp,state:StudentSurveyState,submittedAt:timestamp,tokenHash:text,tuteeId:text,verificationAttempts:int4,verificationDueAt:timestamp
Subject|active:bool,baseName:text,createdAt:timestamp,groupId:text,id:text,levelId:text,name:text
SubjectLevel|active:bool,apScored:bool,createdAt:timestamp,id:text,name:text,prefix:text,rank:int4
Term|active:bool,continuationQuarterTransition:bool,continuationSourceTermId:text,createdAt:timestamp,endDate:timestamp,id:text,name:text,nextRecruitmentRevision:int4,quarter:Quarter,schoolYear:text,signupClosesAt:timestamp,signupEnabled:bool,signupFirstOpenedAt:timestamp,signupOpeningStateSince:timestamp,signupOpensAt:timestamp,signupPreviewUrl:text,startDate:timestamp,tutorSignupClosesAt:timestamp,tutorSignupEnabled:bool,tutorSignupOpensAt:timestamp,tutorSignupPreviewUrl:text
TimeSlot|active:bool,createdAt:timestamp,dayOfWeek:int4,endMin:int4,id:text,label:text,startMin:int4
TranslationDraft|authorId:text,createdAt:timestamp,id:text,operation:text,payload:jsonb,reviewedById:text,state:text,updatedAt:timestamp
Tutee|academicallyGraduated:bool,alternativeNames:text,createdAt:timestamp,email:text,englishName:text,firstChoiceId:text,firstName:text,gradeLevel:text,historyIdentityRevision:int4,id:text,intakeTermId:text,lastName:text,legacyName:text,notes:text,personId:text,phone:text,preferredContact:text,preferredName:text,secondChoiceId:text,signatureName:text,signedAt:timestamp,signedRulebook:bool,signupSource:SignupSource,signupSubmittedAt:timestamp,status:TuteeStatus,updatedAt:timestamp
TuteeAvailability|slotId:text,tuteeId:text
TuteeHistoryInvitation|createdAt:timestamp,email:text,expectedUpdatedAt:timestamp,expiresAt:timestamp,issuedById:text,reason:text,setupAttempts:int4,setupCodeExpiresAt:timestamp,setupCodeHash:text,setupUserId:text,setupVerifiedAt:timestamp,tokenHash:text,tuteeId:text
TuteeHistoryInvitationAttempt|createdAt:timestamp,email:text,expectedUpdatedAt:timestamp,expiresAt:timestamp,id:text,issuedById:text,predecessorFingerprint:text,reason:text,sequence:int4,settledAt:timestamp,status:TuteeHistoryInvitationAttemptStatus,tokenHash:text,tuteeId:text
TuteeRemovalRequest|createdAt:timestamp,eligibleAt:timestamp,id:text,kind:TuteeRemovalKind,pairingId:text,pairingSnapshot:jsonb,reason:text,removedPeriodKey:text,requestedByTutorId:text,resolvedAt:timestamp,resolvedById:text,resolvedByName:text,state:TuteeRequestState,tuteeId:text
TuteeRequestInvalidity|invalidatedAt:timestamp,invalidatedById:text,invalidatedByName:text,invalidityVersion:int4,invalidReason:text,tuteeId:text
Tutor|academicallyGraduated:bool,alternativeNames:text,createdAt:timestamp,email:text,englishName:text,firstName:text,gradeConfirmedAt:timestamp,gradeLevel:int4,gradeSchoolYear:text,historyIdentityRevision:int4,id:text,lastName:text,legacyName:text,nameFieldsConfirmed:bool,personId:text,preferredAssignedBlocks:int4,preferredName:text,status:TutorStatus,updatedAt:timestamp,username:text,workloadPreferenceVersion:int4
TutorApplication|alternativeNames:text,contactVerified:bool,createdAt:timestamp,decidedAt:timestamp,decidedByTutorId:text,decisionComment:text,email:text,firstName:text,id:text,identityRevision:int4,interviewAt:timestamp,interviewCompletedAt:timestamp,interviewDurationMin:int4,interviewQuarter:Quarter,interviewSchoolYear:text,invalidatedAt:timestamp,invalidatedById:text,invalidatedByName:text,invalidityVersion:int4,invalidReason:text,lastName:text,name:text,policyAcceptedAt:timestamp,policyRevision:text,policySnapshot:jsonb,preferredContact:text,preferredName:text,promotedTutorId:text,qualificationDecidedById:text,qualificationReason:text,qualificationSnapshot:jsonb,recalledAt:timestamp,recalledById:text,requestedSubjectId:text,requestedTutorId:text,status:TutorApplicationStatus,type:TutorApplicationType,updatedAt:timestamp
TutorAvailability|slotId:text,tutorId:text
TutorMeeting|createdAt:timestamp,date:timestamp,id:text,termId:text,title:text
TutorProfileOwnership|revision:int4,tutorId:text,userId:text
TutorQualification|approvedById:text,createdAt:timestamp,status:QualificationStatus,subjectId:text,tutorId:text
TutorStatusRequest|createdAt:timestamp,eligibleAt:timestamp,id:text,kind:TutorRequestKind,reason:text,resolvedAt:timestamp,resolvedById:text,resolvedByName:text,state:TutorRequestState,tutorId:text
TutorSubjectWillingness|subjectId:text,tutorId:text,updatedAt:timestamp,willing:bool
User|affiliation:text,alternativeNames:text,canTranslate:bool,createdAt:timestamp,crewStatus:CrewStatus,email:text,emailEventReminders:bool,emailInfo:bool,emailMessages:bool,emailReviewRequests:bool,emailSecondaryRecipients:bool,emailSecurity:bool,emailVerifiedAt:timestamp,firstName:text,gradeLevel:int4,id:text,lastName:text,legacyName:text,mergedIntoId:text,mustChangePassword:bool,name:text,passwordHash:text,personId:text,preferredName:text,profileVersion:int4,recoveryVoidedAt:timestamp,refreshAuthorityRevision:int4,role:Role,sessionVersion:int4,studentId:text,suspendedAt:timestamp,suspendedReason:text,tuteeMember:bool,tutorAccessRevoked:bool,tutorId:text,twoFactorEnabled:bool,username:text
UsernameNamespaceGuard|id:int4,revision:int8
ViewerSignup|affiliation:text,alternativeNames:text,attempts:int4,codeExpiresAt:timestamp,codeHash:text,createdAt:timestamp,email:text,firstName:text,id:text,lastName:text,name:text,preferredName:text,usedAt:timestamp,verifiedAt:timestamp
`
  .trim()
  .split("\n")
  .flatMap((line) => {
    const [table, fields] = line.split("|");
    return (fields ?? "")
      .split(",")
      .map((field) => `${table}|${field.replace(":", "|")}`);
  })
  .sort();
const REVIEWED_ENUMS = `
AcademicStatus|GRADUATED
AcademicStatus|NOT_APPLICABLE
AcademicStatus|REPORTED
AcademicStatus|UNKNOWN
AdjustmentType|EXTRA
AdjustmentType|PUNISHMENT
AppealState|APPROVED
AppealState|DENIED
AppealState|PENDING
ApprovalStatus|APPROVED
ApprovalStatus|CANCELLED
ApprovalStatus|PENDING
ApprovalStatus|REJECTED
CardColor|RED
CardColor|YELLOW
CardReviewStatus|INVALID
CardReviewStatus|PENDING
CardReviewStatus|VALID
CardSource|AUTO
CardSource|TUTOR
CrewApplicationStatus|ACCEPTED
CrewApplicationStatus|PENDING
CrewApplicationStatus|REJECTED
CrewRequestKind|OPT_OUT
CrewRequestKind|REENTRY
CrewRequestState|APPROVED
CrewRequestState|DENIED
CrewRequestState|PENDING
CrewRequestState|RECALLED
CrewStatus|ACTIVE
CrewStatus|INACTIVE
CrewStatus|OPTED_OUT
Headcount|FOUR_PLUS
Headcount|ONE
Headcount|THREE
Headcount|TWO
Headcount|ZERO
MeetingAttendanceStatus|EXCUSED_ABSENT
MeetingAttendanceStatus|EXEMPT
MeetingAttendanceStatus|PRESENT
MeetingAttendanceStatus|UNEXCUSED_ABSENT
NewsStatus|ARCHIVED
NewsStatus|DRAFT
NewsStatus|PUBLISHED
PairingRoomMode|AUTO
PairingRoomMode|FIXED
PairingRoomMode|LEGACY
PairingRoomMode|NONE
PersonResolutionState|GROUPED
PersonResolutionState|REVIEW_REQUIRED
ProgramFeatureKey|AUTO_ASSIGN_ROOMS
ProgramFeatureKey|CREW
ProgramFeatureKey|DISCIPLINE
ProgramFeatureKey|EMAIL_2FA
ProgramFeatureKey|INTERVIEWS
ProgramFeatureKey|MEETINGS
ProgramFeatureKey|QUARTER_SYSTEM
ProgramFeatureKey|SERVICE_HOURS
ProgramFeatureKey|VIEWER_SIGNUP
QualificationStatus|APPROVED
QualificationStatus|PENDING
QualificationStatus|REJECTED
Quarter|Q1
Quarter|Q2
Quarter|Q3
Quarter|Q4
RecruitmentAudience|tutee
RecruitmentAudience|tutor
RegistrationCodeKind|ADMIN
RegistrationCodeKind|COORDINATOR
RegistrationCodeKind|CREW
RegistrationCodeKind|TUTOR
Role|ADMIN
Role|COORDINATOR
Role|CREW
Role|HEAD
Role|STUDENT
Role|TUTOR
Role|VIEWER
ScheduledRefreshState|BLOCKED
ScheduledRefreshState|CANCELLED
ScheduledRefreshState|COMPLETED
ScheduledRefreshState|FAILED
ScheduledRefreshState|SCHEDULED
SectionMode|INLINE
SectionMode|PAGE
SessionFlagState|DISMISSED
SessionFlagState|ESCALATED
SessionFlagState|PENALIZED
SessionFlagState|PENDING
SessionFlagState|WARNED
SessionTutorStatus|EXTRA
SessionTutorStatus|PRESENT
SessionTutorStatus|RESCHEDULED
SessionTutorStatus|TUTOR_ABSENT
SignupSource|SELF_SERVICE
SignupSource|STAFF
SignupSource|UNKNOWN
StudentReviewKind|SCHEDULE_CONFLICT
StudentReviewKind|STUDENT_ABORT
StudentSignupAppealState|ACCEPTED
StudentSignupAppealState|PENDING
StudentSignupAppealState|REJECTED
StudentSurveyState|ABORTED
StudentSurveyState|DISQUALIFIED
StudentSurveyState|INVALID_REJECTED
StudentSurveyState|OPEN
StudentSurveyState|RECALLED
TuteeAttendanceStatus|EXCUSED_ABSENT
TuteeAttendanceStatus|PRESENT
TuteeAttendanceStatus|UNEXCUSED_ABSENT
TuteeHistoryInvitationAttemptStatus|ADMITTED
TuteeHistoryInvitationAttemptStatus|DELIVERY_FAILED
TuteeHistoryInvitationAttemptStatus|PUBLISHED
TuteeHistoryInvitationAttemptStatus|SUPERSEDED
TuteeRemovalKind|PUNISHMENT
TuteeRemovalKind|VOLUNTARY
TuteeRequestState|APPROVED
TuteeRequestState|DENIED
TuteeRequestState|PENDING
TuteeRequestState|RECALLED
TuteeRequestState|REINSTATED
TuteeStatus|ACTIVE
TuteeStatus|INACTIVE
TuteeStatus|PENDING
TutorApplicationStatus|ACCEPTED
TutorApplicationStatus|INTERVIEW
TutorApplicationStatus|PENDING
TutorApplicationStatus|RECALLED
TutorApplicationStatus|REJECTED
TutorApplicationType|ADDITIONAL_SUBJECT
TutorApplicationType|HIGHER_LEVEL
TutorApplicationType|INITIAL
TutorRequestKind|OPT_OUT
TutorRequestKind|REENTRY
TutorRequestState|APPROVED
TutorRequestState|DENIED
TutorRequestState|PENDING
TutorRequestState|RECALLED
TutorStatus|ACTIVE
TutorStatus|ARCHIVED
TutorStatus|GRADUATED
TutorStatus|OPTED_OUT
TutorStatus|PENDING
TutorStatus|TRANSFERRED
VerificationPurpose|EMAIL_CHANGE
VerificationPurpose|LOGIN_2FA
VerificationPurpose|PASSWORD_CHANGE
VerificationPurpose|PASSWORD_RESET
VerificationPurpose|SECONDARY_EMAIL
`
  .trim()
  .split("\n")
  .sort();
const IDENTITY_ADDITIONS = `
EmailDelivery|sourceNotificationId:text
HistoryRowOwnership|entity:text,quarantineUserIds:_text,readerUserId:text,receiptId:text,recordId:text,revision:int4,sourceUserIds:_text,updatedAt:timestamp
PairingExecutionSuccessor|effectiveAt:timestamp,receiptId:text,revision:int4,sourcePairingId:text,targetPairingId:text
ParticipantConsolidation|active:bool,effectiveAt:timestamp,kind:text,receiptId:text,revision:int4,sourceId:text,targetId:text
PersonCombineReceipt|ownershipTransfers:jsonb
PersonHistoryCorrectionReceipt|actorId:text,after:jsonb,before:jsonb,createdAt:timestamp,destinationPersonId:text,id:text,inputHash:text,personId:text,sourceUserIds:_text,subjects:jsonb
PersonParticipationTransferReceipt|actorId:text,createdAt:timestamp,id:text,inputHash:text,personId:text,result:jsonb,retainedUserId:text,selection:jsonb,subjects:jsonb
PersonPartitionReceipt|actorId:text,createdAt:timestamp,id:text,inputHash:text,newPersonId:text,personId:text,sources:jsonb,subjects:jsonb
QualificationTransferGrant|active:bool,approvedAt:timestamp,approvedById:text,grantedAt:timestamp,receiptId:text,revision:int4,sourceSubjectId:text,sourceTutorId:text,subjectId:text,targetTutorId:text
RetiredHistoryOwnership|readerUserId:text,receiptId:text,revision:int4,sourceUserId:text,state:text,updatedAt:timestamp
SessionParticipantExecution|participantId:text,receiptId:text,revision:int4,sourceSurveyIds:_text,tuteeId:text
SessionPlanExecution|assignments:jsonb,planId:text,receiptId:text,revision:int4,tutorId:text
SessionResponseExecution|profileId:text,profileKind:text,receiptId:text,respondedByUserId:text,responseId:text,revision:int4,userId:text
StudentRequestExecutionAssignment|createdAt:timestamp,pairingId:text,receiptId:text,releasedAt:timestamp,revision:int4,sourceTuteeId:text,surveyId:text,tuteeId:text
User|historyAccessRevision:int4
`
  .trim()
  .split("\n")
  .flatMap((line) => {
    const [table, fields] = line.split("|");
    return (fields ?? "")
      .split(",")
      .map((field) => `${table}|${field.replace(":", "|")}`);
  })
  .sort();
const REVIEWED_IDENTITY_COLUMNS = [
  ...REVIEWED_COLUMNS,
  ...IDENTITY_ADDITIONS,
].sort();
// Keep already reviewed backup schemas readable. A complete additive table is
// reviewed separately; partial or unknown columns still fail the exact match.
const LEGACY_DECLINE_COLUMNS =
  "clientKey:uuid,expectedUpdatedAt:timestamp,inputHash:text,intakeSnapshot:jsonb,resolvedAt:timestamp,resolvedById:text,resolvedByName:text,termId:text,tuteeId:text"
    .split(",")
    .map((field) => `LegacySignupDecline|${field.replace(":", "|")}`);
const REVIEWED_DECLINE_COLUMNS = [
  ...REVIEWED_COLUMNS,
  ...LEGACY_DECLINE_COLUMNS,
].sort();
const REVIEWED_IDENTITY_DECLINE_COLUMNS = [
  ...REVIEWED_IDENTITY_COLUMNS,
  ...LEGACY_DECLINE_COLUMNS,
].sort();
// Stopped operation authority is additive and permanent. Old backups remain
// inspectable; a partial or changed closure table is never a reviewed schema.
const INVITATION_CLOSURE_COLUMNS =
  "createdAt:timestamp,inputHash:text,issuedById:text,operationId:text,scopeKey:text"
    .split(",")
    .map(
      (field) =>
        `HistoricalInvitationOperationClosure|${field.replace(":", "|")}`,
    )
    .sort();
const TRANSLATION_INTENT_COLUMNS =
  "actorId:text,cleared:bool,createdAt:timestamp,draftId:text,inputHash:text,intentId:text,mode:text,operation:text,protocolVersion:int4,status:text"
    .split(",")
    .map((field) => `TranslationIntentReceipt|${field.replace(":", "|")}`)
    .sort();
const PRISMA_METADATA = [
  "applied_steps_count|int4",
  "checksum|varchar",
  "finished_at|timestamptz",
  "id|varchar",
  "logs|text",
  "migration_name|varchar",
  "rolled_back_at|timestamptz",
  "started_at|timestamptz",
].sort();
const IMPORT_PROVENANCE_COLUMNS = [
  "ImportedRecordProvenance|entity|text",
  "ImportedRecordProvenance|importedAt|timestamp",
  "ImportedRecordProvenance|recordId|text",
].sort();

export const reviewedRecoverySchemaMetadata = {
  importProvenanceColumns: IMPORT_PROVENANCE_COLUMNS.map((line) => {
    const [table_name, column_name, udt_name] = line.split("|");
    return { table_name, column_name, udt_name };
  }),
  translationIntentReceiptColumns: TRANSLATION_INTENT_COLUMNS.map((line) => {
    const [table_name, column_name, udt_name] = line.split("|");
    return { table_name, column_name, udt_name };
  }),
  historicalInvitationOperationClosureColumns: INVITATION_CLOSURE_COLUMNS.map(
    (line) => {
      const [table_name, column_name, udt_name] = line.split("|");
      return { table_name, column_name, udt_name };
    },
  ),
  legacyDeclineColumns: REVIEWED_DECLINE_COLUMNS.map((line) => {
    const [table_name, column_name, udt_name] = line.split("|");
    return { table_name, column_name, udt_name };
  }),
  identityLegacyDeclineColumns: REVIEWED_IDENTITY_DECLINE_COLUMNS.map(
    (line) => {
      const [table_name, column_name, udt_name] = line.split("|");
      return { table_name, column_name, udt_name };
    },
  ),
  identityColumns: REVIEWED_IDENTITY_COLUMNS.map((line) => {
    const [table_name, column_name, udt_name] = line.split("|");
    return { table_name, column_name, udt_name };
  }),
  columns: REVIEWED_COLUMNS.map((line) => {
    const [table_name, column_name, udt_name] = line.split("|");
    return { table_name, column_name, udt_name };
  }),
  enums: REVIEWED_ENUMS.map((line) => {
    const [type_name, enum_label] = line.split("|");
    return { type_name, enum_label };
  }),
};

export function assertReviewedRecoverySchema(
  columns: Record<string, unknown>[],
  enums: Record<string, unknown>[],
) {
  const translation = columns
    .filter((row) => row.table_name === "TranslationIntentReceipt")
    .map(
      (row) =>
        `${String(row.table_name)}|${String(row.column_name)}|${String(row.udt_name)}`,
    )
    .sort();
  operatorAssert(
    translation.length === 0 ||
      translation.join("\n") === TRANSLATION_INTENT_COLUMNS.join("\n"),
    "UNREVIEWED_PUBLIC_RECOVERY_SCHEMA",
  );
  const closure = columns
    .filter((row) => row.table_name === "HistoricalInvitationOperationClosure")
    .map(
      (row) =>
        `${String(row.table_name)}|${String(row.column_name)}|${String(row.udt_name)}`,
    )
    .sort();
  operatorAssert(
    closure.length === 0 ||
      closure.join("\n") === INVITATION_CLOSURE_COLUMNS.join("\n"),
    "UNREVIEWED_PUBLIC_RECOVERY_SCHEMA",
  );
  const domain = columns
    .filter(
      (row) =>
        row.table_name !== "_prisma_migrations" &&
        row.table_name !== "HistoricalInvitationOperationClosure" &&
        row.table_name !== "TranslationIntentReceipt",
    )
    .map(
      (row) =>
        `${String(row.table_name)}|${String(row.column_name)}|${String(row.udt_name)}`,
    )
    .sort();
  // Both additive policy columns are reviewed together. Older complete backups
  // remain readable; a partial upgrade is never silently accepted.
  const policyColumns = [
    "ProgramCalendarDay|schedulingEffect|text",
    "SessionPlanParticipant|tutoringPauseSuppressed|bool",
  ];
  const historyColumns = REVIEWED_COLUMNS.filter((column) =>
    column.startsWith("ProgramCalendarPolicyRevision|"),
  );
  const hasHistory = domain.some((column) =>
    column.startsWith("ProgramCalendarPolicyRevision|"),
  );
  const comparedDomain = hasHistory
    ? domain
    : [
        ...domain,
        ...historyColumns,
        ...(policyColumns.every((column) => !domain.includes(column))
          ? policyColumns
          : []),
      ].sort();
  const migration = columns
    .filter((row) => row.table_name === "_prisma_migrations")
    .map((row) => `${String(row.column_name)}|${String(row.udt_name)}`)
    .sort();
  // Accept only the complete reviewed archive boundary. Its removal or partial
  // restoration must not widen the authority of an otherwise reviewed backup.
  const provenance = domain.filter((column) =>
    column.startsWith("ImportedRecordProvenance|"),
  );
  operatorAssert(
    provenance.length === 0 ||
      provenance.join("\n") === IMPORT_PROVENANCE_COLUMNS.join("\n"),
    "UNREVIEWED_PUBLIC_RECOVERY_SCHEMA",
  );
  // Compose the independently reviewed tutoring-era and import-boundary profiles.
  const reviewedDomain = comparedDomain.filter(
    (column) => !column.startsWith("ImportedRecordProvenance|"),
  );
  const identityVersion: 0 | 1 | null =
    reviewedDomain.join("\n") === REVIEWED_COLUMNS.join("\n") ||
    reviewedDomain.join("\n") === REVIEWED_DECLINE_COLUMNS.join("\n")
      ? 0
      : reviewedDomain.join("\n") === REVIEWED_IDENTITY_COLUMNS.join("\n") ||
          reviewedDomain.join("\n") ===
            REVIEWED_IDENTITY_DECLINE_COLUMNS.join("\n")
        ? 1
        : null;
  operatorAssert(identityVersion !== null, "UNREVIEWED_PUBLIC_RECOVERY_SCHEMA");
  operatorAssert(
    migration.length === 0 ||
      migration.join("\n") === PRISMA_METADATA.join("\n"),
    "UNREVIEWED_MIGRATION_METADATA_SCHEMA",
  );
  const labels = enums
    .map((row) => `${String(row.type_name)}|${String(row.enum_label)}`)
    .sort();
  operatorAssert(
    labels.join("\n") === REVIEWED_ENUMS.join("\n"),
    "UNREVIEWED_RECOVERY_ENUM_SCHEMA",
  );
  return {
    translationIntentReceipt: translation.length > 0,
    historicalInvitationOperationClosure: closure.length > 0,
    identityVersion,
    legacySignupDecline: domain.some((column) =>
      column.startsWith("LegacySignupDecline|"),
    ),
  };
}
