/**
 * Backend Integration Reference
 *
 * This file shows what data structure the frontend expects
 * from your Socket.IO backend for proper engagement tracking
 */

// ============================================================================
// BEFORE (What your backend currently sends - CAUSES THE BUG)
// ============================================================================

const INCORRECT_BACKEND_DATA = {
  classroom_id: "class-123",
  student_id: "student-456",
  student_name: "Alice Johnson",

  // ❌ These fields mix presence and engagement
  is_active: true,
  face_detected: true,                    // This only tells us about PRESENCE
  multiple_faces: false,
  looking_at_screen: undefined,           // Missing! Dashboard can't use it
  engagement_percentage: 85,              // Unclear what this represents

  // ❌ Problems:
  // 1. No clear "attention" field for dashboard to count
  // 2. "face_detected" gets used as "present" but should only mean "presence"
  // 3. "looking_at_screen" is undefined, so dashboard can't determine engagement
  // 4. Dashboard falls back to counting "face_detected" → MARKS DISTRACTED AS PRESENT
}

// ============================================================================
// AFTER (What backend SHOULD send - FIXES THE BUG)
// ============================================================================

const CORRECT_BACKEND_DATA = {
  classroom_id: "class-123",
  student_id: "student-456",
  student_name: "Alice Johnson",

  // ✓ Separated concepts
  is_active: true,

  // ✓ Clear presence indicator
  face_detected: true,                    // Boolean: Was a face detected?
  face_count: 1,                          // Number: How many faces?

  // ✓ Clear engagement status (THIS IS THE KEY FIELD)
  attention: "focused",                   // "focused" | "distracted" | "absent"

  // ✓ Additional metrics for teacher dashboard
  attention_score: 85,                    // 0-100: Granular attention metric
  engagement_percentage: 85,              // 0-100: Engagement percentage

  timestamp: Date.now(),

  // ✓ Optional: time-based data
  focused_duration_ms: 45000,             // How long focused this session
  distracted_duration_ms: 15000,          // How long distracted
}

// ============================================================================
// WHAT EACH FIELD MEANS
// ============================================================================

/**
 * PRESENCE FIELDS (What the student's physical status is):
 */
const PRESENCE_FIELDS = {
  face_detected: true,        // Type: Boolean - Is there a face in the frame?
  face_count: 1,              // Type: Number - How many faces? (>1 = cheating indicator)
}

/**
 * ENGAGEMENT FIELDS (What the student's attention level is):
 */
const ENGAGEMENT_FIELDS = {
  attention: "focused",       // Type: String - "focused" | "distracted" | "absent"
  // ↑ THIS IS WHAT THE DASHBOARD COUNTS

  attention_score: 85,        // Type: Number (0-100) - Granular metric
}

/**
 * STATUS DERIVATION LOGIC (in backend):
 *
 * The backend should compute `attention` as follows:
 *
 * if (!face_detected) {
 *   attention = "absent"              // No face detected (after 10 sec smoothing)
 * } else if (face_count > 1) {
 *   attention = "distracted"          // Multiple faces = cheating
 * } else if (looking_at_screen) {
 *   // looking_at_screen comes from attention_score or gaze tracking
 *   attention = "focused"             // Face detected + looking at screen
 * } else {
 *   attention = "distracted"          // Face detected + NOT looking (after 5 sec smoothing)
 * }
 */

// ============================================================================
// EXAMPLE PAYLOADS FOR DIFFERENT SCENARIOS
// ============================================================================

const SCENARIO_FOCUSED = {
  // Student looking at screen, engaged
  student_id: "student-1",
  face_detected: true,
  face_count: 1,
  attention: "focused",                   // ✓ Should be "focused"
  attention_score: 92,
  timestamp: Date.now()
}

const SCENARIO_DISTRACTED = {
  // Student present but looking away (distracted)
  student_id: "student-2",
  face_detected: true,
  face_count: 1,
  attention: "distracted",                // ✓ Should be "distracted" (NOT "absent"!)
  attention_score: 35,
  timestamp: Date.now()
}

const SCENARIO_ABSENT = {
  // No face detected, student not present
  student_id: "student-3",
  face_detected: false,
  face_count: 0,
  attention: "absent",                    // ✓ Should be "absent"
  attention_score: 0,
  timestamp: Date.now()
}

const SCENARIO_CHEATING = {
  // Multiple faces in frame (potential cheating)
  student_id: "student-4",
  face_detected: true,
  face_count: 2,                          // Multiple faces!
  attention: "distracted",                // ✓ Marked as distracted (security concern)
  attention_score: 0,
  timestamp: Date.now()
}

// ============================================================================
// SOCKET.IO EVENT FORMAT
// ============================================================================

/**
 * Frontend sends to backend:
 * Event: "engagement-update"
 *
 * Payload:
 * {
 *   classId: "class-123",
 *   userId: "student-456",
 *   attention: "focused",          // Frontend computes this with smoothing
 *   faceDetected: true,
 *   attentionScore: 85,
 *   timestamp: Date.now()
 * }
 */

/**
 * Backend broadcasts to teacher:
 * Event: "engagement-update:class-123"
 *
 * Payload (per student):
 * {
 *   student_id: "student-456",
 *   student_name: "Alice Johnson",
 *   is_active: true,
 *   attention: "focused",              // KEY FIELD FOR DASHBOARD
 *   face_detected: true,
 *   face_count: 1,
 *   attention_score: 85,
 *   engagement_percentage: 92,
 *   timestamp: Date.now()
 * }
 */

// ============================================================================
// DASHBOARD COUNTING LOGIC (CORRECT)
// ============================================================================

// ✓ This is what LiveEngagementPanelFixed.jsx does:
const CORRECT_DASHBOARD_COUNTS = (students) => {
  return {
    total: students.length,
    focused: students.filter(s => s.attention === 'focused').length,      // Was looking at screen
    distracted: students.filter(s => s.attention === 'distracted').length, // Face present, not looking
    absent: students.filter(s => s.attention === 'absent').length,         // No face detected
  }
}

// ❌ This is what LiveEngagementPanel.jsx does (WRONG):
const INCORRECT_DASHBOARD_COUNTS = (students) => {
  return {
    total: students.length,
    present: students.filter(s => s.face_detected).length,        // ❌ Includes distracted!
    engaged: students.filter(s => s.face_detected && s.looking_at_screen).length,  // ❌ looking_at_screen undefined
    absent: students.length - students.filter(s => s.face_detected).length,
  }
}

// ============================================================================
// MIGRATION CHECKLIST
// ============================================================================

const BACKEND_MIGRATION_CHECKLIST = `
CHECKLIST: Update your backend to send correct engagement data

Backend Event: "engagement-update:classroom-id"
(Teacher receives this event for each student update)

□ 1. Include "attention" field (values: "focused" | "distracted" | "absent")
     - This is what the dashboard counts
     - Computed by your backend's engagement detection service

□ 2. Include "face_detected" boolean
     - Tells frontend if a face was detected
     - Used for presence verification

□ 3. Include "face_count" number
     - 0 = no face
     - 1 = single person (normal)
     - >1 = multiple people (security alert)

□ 4. Include "attention_score" number (0-100)
     - Granular metric for extra detail
     - Can be used for future analytics

□ 5. Include "timestamp" number
     - When the detection was recorded

□ 6. Remove or deprecate:
     - "isPresent" (replaced by "attention" field)
     - "looking_at_screen" undefined (replaced by "attention" computed from multiple inputs)

□ 7. Test with sample data:
     - Send "focused" → Dashboard shows green
     - Send "distracted" → Dashboard shows amber
     - Send "absent" → Dashboard shows red

□ 8. Verify Socket.IO payload structure matches example above
`

export {
  CORRECT_BACKEND_DATA,
  SCENARIO_FOCUSED,
  SCENARIO_DISTRACTED,
  SCENARIO_ABSENT,
  SCENARIO_CHEATING,
  CORRECT_DASHBOARD_COUNTS,
  BACKEND_MIGRATION_CHECKLIST
}
