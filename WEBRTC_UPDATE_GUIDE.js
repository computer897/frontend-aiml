/**
 * WEBRTC.JS UPDATE GUIDE
 *
 * Current sendEngagementUpdate signature (NEEDS UPDATE):
 *
 * sendEngagementUpdate(studentId, status, studentName, cameraOn, isPresent, timestamp)
 *
 * Updated signature (WITH FIX):
 *
 * sendEngagementUpdate(studentId, attention, studentName, cameraOn, faceDetected, attentionScore, timestamp)
 */

// ============================================================================
// CURRENT CODE (in src/services/webrtc.js around line 807)
// ============================================================================

/**
 * BEFORE - Current implementation
 */
const CURRENT_IMPLEMENTATION = `
function sendEngagementUpdate(studentId, status, studentName, cameraOn, isPresent = status !== 'not-detected', timestamp = Date.now()) {
  if (!socket || !roomId) return
  socket.emit('engagement-update', {
    studentId,
    status,           // ← "attentive" | "distracted" | "not-detected" (confusing names!)
    studentName,
    cameraOn,
    isPresent,        // ← Boolean, doesn't distinguish focused vs distracted
    timestamp
  })
}
`

/**
 * AFTER - Improved implementation
 */
const UPDATED_IMPLEMENTATION = `
function sendEngagementUpdate(
  studentId,
  attention,        // ← NOW: "focused" | "distracted" | "absent" (clearer names!)
  studentName,
  cameraOn,
  faceDetected,     // ← Raw detection data
  attentionScore,   // ← Granular metric (0-100)
  timestamp = Date.now()
) {
  if (!socket || !roomId) return

  // Send proper engagement data with all necessary fields
  socket.emit('engagement-update', {
    studentId,
    attention,        // ← KEY FIELD: "focused" | "distracted" | "absent"
    studentName,
    cameraOn,
    faceDetected,     // ← Additional data for backend
    attentionScore,   // ← Additional data for backend
    timestamp
  })
}
`

// ============================================================================
// INTEGRATION STEPS
// ============================================================================

/**
 * Step 1: Find the sendEngagementUpdate function in src/services/webrtc.js
 *
 * Search for:
 * function sendEngagementUpdate(studentId, status, studentName...
 *
 * Line number: Approximately 807
 */

/**
 * Step 2: Replace the function signature and implementation
 *
 * OLD:
 * ```
 * function sendEngagementUpdate(studentId, status, studentName, cameraOn, isPresent = status !== 'not-detected', timestamp = Date.now()) {
 *   if (!socket || !roomId) return
 *   socket.emit('engagement-update', { studentId, status, studentName, cameraOn, isPresent, timestamp })
 * }
 * ```
 *
 * NEW:
 * ```
 * function sendEngagementUpdate(
 *   studentId,
 *   attention,
 *   studentName,
 *   cameraOn,
 *   faceDetected,
 *   attentionScore,
 *   timestamp = Date.now()
 * ) {
 *   if (!socket || !roomId) return
 *   socket.emit('engagement-update', {
 *     studentId,
 *     attention,
 *     studentName,
 *     cameraOn,
 *     faceDetected,
 *     attentionScore,
 *     timestamp
 *   })
 * }
 * ```
 */

/**
 * Step 3: Update the call site in useEngagementDetectionImproved.js
 *
 * The new hook already calls it with the correct signature:
 *
 * webrtcRef.current.sendEngagementUpdate(
 *   userId,
 *   stableAttention,        // "focused" | "distracted" | "absent"
 *   userName,
 *   cameraOn,
 *   faceDetectedThisRound,  // true | false
 *   currentAttentionScore,  // 0-100
 *   Date.now()
 * )
 */

// ============================================================================
// DATA FLOW DIAGRAM
// ============================================================================

/**
 * BEFORE (WRONG):
 *
 * Face Detection → useEngagementDetection →
 *   sendEngagementUpdate(studentId, "attentive", ..., isPresent=true) →
 *   Socket.IO → Backend → LiveEngagementPanel
 *                                         ↓
 *                         presentCount = students.filter(s => s.face_detected)
 *                         (❌ MARKS DISTRACTED AS PRESENT)
 */

/**
 * AFTER (CORRECT):
 *
 * Face Detection → useEngagementDetectionImproved →
 *   sendEngagementUpdate(studentId, "focused", ..., faceDetected, attentionScore) →
 *   Socket.IO → Backend → LiveEngagementPanelFixed
 *                                         ↓
 *                         focusedCount = students.filter(s => s.attention === 'focused')
 *                         distractedCount = students.filter(s => s.attention === 'distracted')
 *                         absentCount = students.filter(s => s.attention === 'absent')
 *                         (✓ CORRECT CLASSIFICATION)
 */

// ============================================================================
// PARAMETER MAPPING
// ============================================================================

const PARAMETER_MAPPING = {
  // Input from frontend engagement detection:
  'stableAttention': {
    type: 'string',
    values: ['focused', 'distracted', 'absent'],
    description: 'The smoothed engagement attention state',
    parameter: 'attention'
  },

  'faceDetectedThisRound': {
    type: 'boolean',
    description: 'Whether a face was detected in this detection round',
    parameter: 'faceDetected'
  },

  'currentAttentionScore': {
    type: 'number',
    range: [0, 100],
    description: 'Raw attention score (granular metric)',
    parameter: 'attentionScore'
  },

  // Unchanged parameters:
  'userId': {
    type: 'string',
    description: 'Student ID',
    parameter: 'studentId'
  },

  'userName': {
    type: 'string',
    description: 'Student name',
    parameter: 'studentName'
  },

  'cameraOn': {
    type: 'boolean',
    description: 'Is the student\'s camera enabled',
    parameter: 'cameraOn'
  },

  'timestamp': {
    type: 'number',
    description: 'Timestamp of the detection',
    parameter: 'timestamp'
  }
}

// ============================================================================
// EXAMPLE EMISSIONS
// ============================================================================

const EXAMPLE_BEFORE = `
// OLD: Confusing data
socket.emit('engagement-update', {
  studentId: 'student-1',
  status: 'attentive',              // ← Confusing term
  studentName: 'Alice',
  cameraOn: true,
  isPresent: true,                  // ← Doesn't distinguish focused/distracted
  timestamp: 1234567890
})
`

const EXAMPLE_AFTER = `
// NEW: Clear, actionable data
socket.emit('engagement-update', {
  studentId: 'student-1',
  attention: 'focused',             // ← Clear term, one of 3 states
  studentName: 'Alice',
  cameraOn: true,
  faceDetected: true,               // ← Raw detection data
  attentionScore: 92,               // ← Granular metric
  timestamp: 1234567890
})
`

// ============================================================================
// VERIFICATION CHECKLIST
// ============================================================================

const VERIFICATION = `
After updating webrtc.js:

□ 1. Function signature updated with new parameters
     ✓ attention (instead of status)
     ✓ faceDetected (instead of isPresent)
     ✓ attentionScore (new parameter)

□ 2. Socket emission includes all fields:
     socket.emit('engagement-update', {
       studentId,
       attention,      ✓
       studentName,
       cameraOn,
       faceDetected,   ✓
       attentionScore, ✓
       timestamp
     })

□ 3. Backend receives correct data structure
     Event: 'engagement-update'
     Payload includes: attention, faceDetected, attentionScore

□ 4. Teacher receives updates with attention field
     Event: 'engagement-update:classroom-id'
     Each student has: attention, face_detected, attention_score

□ 5. Browser console shows no errors
     DevTools → Console → No errors about undefined properties

□ 6. Teacher dashboard displays correct status
     Focused (green) / Distracted (amber) / Absent (red)
`

export {
  CURRENT_IMPLEMENTATION,
  UPDATED_IMPLEMENTATION,
  PARAMETER_MAPPING,
  EXAMPLE_BEFORE,
  EXAMPLE_AFTER,
  VERIFICATION
}
