/**
 * Face Detection Service - Browser-Side Only (MediaPipe Face Mesh)
 *
 * Uses MediaPipe Face Mesh locally in the browser for privacy-first detection.
 * Only metadata is transmitted to the backend for attendance tracking.
 */

const MODEL_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js'
]

let modelsLoaded = false
let modelsLoading = false
let faceMeshInstance = null
let pendingResultResolver = null

const HEAD_POSE_LIMITS = {
  pitch: 20,
  yaw: 30,
  roll: 15
}

const EAR_THRESHOLD = 0.2
const CENTER_DEVIATION_LIMIT = 0.3
const GRACE_PERIOD_MS = 9000

const safeNumber = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const distance2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const radiansToDegrees = (radians) => radians * (180 / Math.PI)

async function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = reject
    document.head.appendChild(script)
  })
}

function isVideoReady(videoElement) {
  return !!(
    videoElement &&
    videoElement.readyState >= 2 &&
    videoElement.videoWidth > 0 &&
    videoElement.videoHeight > 0 &&
    !videoElement.paused &&
    !videoElement.ended
  )
}

async function ensureFaceMesh() {
  if (modelsLoaded && faceMeshInstance) return true
  if (modelsLoading) return new Promise((resolve) => {
    const check = setInterval(() => {
      if (modelsLoaded) {
        clearInterval(check)
        resolve(true)
      }
    }, 100)
  })

  modelsLoading = true
  try {
    for (const src of MODEL_SCRIPTS) {
      await loadScript(src)
    }

    const FaceMesh = window.FaceMesh
    if (!FaceMesh) {
      throw new Error('MediaPipe FaceMesh global not found')
    }

    faceMeshInstance = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    })

    faceMeshInstance.setOptions({
      maxNumFaces: 2,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    })

    faceMeshInstance.onResults((results) => {
      if (pendingResultResolver) {
        pendingResultResolver(results)
        pendingResultResolver = null
      }
    })

    modelsLoaded = true
    modelsLoading = false
    return true
  } catch (error) {
    console.error('[FaceDetection] Failed to initialize MediaPipe:', error)
    modelsLoading = false
    return false
  }
}

export async function loadFaceDetectionModels() {
  return ensureFaceMesh()
}

async function runFaceMesh(videoElement) {
  if (!faceMeshInstance || pendingResultResolver) {
    return null
  }

  return new Promise((resolve) => {
    pendingResultResolver = resolve
    faceMeshInstance.send({ image: videoElement })
  })
}

function computeHeadPose(landmarks) {
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]
  const noseTip = landmarks[1]
  const chin = landmarks[152]
  const forehead = landmarks[10]
  const leftCheek = landmarks[234]
  const rightCheek = landmarks[454]

  const eyeLineAngle = radiansToDegrees(Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x))
  const roll = clamp(eyeLineAngle, -90, 90)

  const eyeCenterX = (leftEye.x + rightEye.x) / 2
  const eyeDistance = Math.max(0.0001, Math.abs(rightEye.x - leftEye.x))
  const yawRatio = clamp((noseTip.x - eyeCenterX) / eyeDistance, -1, 1)
  const yaw = yawRatio * 60

  const noseToChin = distance2d(noseTip, chin)
  const noseToForehead = distance2d(noseTip, forehead)
  const pitchRatio = clamp((noseToChin - noseToForehead) / (noseToChin + noseToForehead + 0.0001), -1, 1)
  const pitch = pitchRatio * 60

  const cheekDiff = distance2d(noseTip, rightCheek) - distance2d(noseTip, leftCheek)
  const yawFromCheeks = clamp((cheekDiff / (distance2d(leftCheek, rightCheek) + 0.0001)) * 60, -60, 60)

  return {
    pitch: safeNumber(pitch, 0),
    yaw: safeNumber((yaw + yawFromCheeks) / 2, 0),
    roll: safeNumber(roll, 0)
  }
}

function computeEyeAspectRatio(landmarks, eyeIndices) {
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map((idx) => landmarks[idx])
  const vertical1 = distance2d(p2, p6)
  const vertical2 = distance2d(p3, p5)
  const horizontal = distance2d(p1, p4)
  if (horizontal === 0) return 0
  return (vertical1 + vertical2) / (2 * horizontal)
}

function computeFaceCentering(landmarks) {
  const noseTip = landmarks[1]
  const deviationX = Math.abs(noseTip.x - 0.5) / 0.5
  const deviationY = Math.abs(noseTip.y - 0.5) / 0.5
  const deviation = Math.max(deviationX, deviationY)
  return {
    deviation: clamp(deviation, 0, 1),
    centered: deviation <= CENTER_DEVIATION_LIMIT
  }
}

export async function analyzeFrame(videoElement) {
  if (!modelsLoaded || !faceMeshInstance) {
    return {
      success: false,
      error: 'Models not loaded',
      face_detected: false,
      face_count: 0,
      multiple_faces: false,
      timestamp: new Date().toISOString()
    }
  }

  if (!isVideoReady(videoElement)) {
    return {
      success: false,
      error: 'Video not ready',
      face_detected: false,
      face_count: 0,
      multiple_faces: false,
      timestamp: new Date().toISOString()
    }
  }

  try {
    const results = await runFaceMesh(videoElement)
    if (!results || !results.multiFaceLandmarks) {
      return {
        success: true,
        face_detected: false,
        face_count: 0,
        multiple_faces: false,
        looking_at_screen: false,
        stable_attention: false,
        eyes_open: false,
        ear: 0,
        pitch: 0,
        yaw: 0,
        roll: 0,
        center_deviation: 1,
        face_centered: false,
        confidence: 0,
        timestamp: new Date().toISOString()
      }
    }

    const faceCount = results.multiFaceLandmarks.length
    const faceDetected = faceCount > 0
    const multipleFaces = faceCount > 1
    const landmarks = results.multiFaceLandmarks[0]

    if (!faceDetected || !landmarks) {
      return {
        success: true,
        face_detected: false,
        face_count: faceCount,
        multiple_faces: multipleFaces,
        looking_at_screen: false,
        stable_attention: false,
        eyes_open: false,
        ear: 0,
        pitch: 0,
        yaw: 0,
        roll: 0,
        center_deviation: 1,
        face_centered: false,
        confidence: 0,
        timestamp: new Date().toISOString()
      }
    }

    const headPose = computeHeadPose(landmarks)
    const centering = computeFaceCentering(landmarks)
    const noseTip = landmarks[1]
    const leftEar = computeEyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144])
    const rightEar = computeEyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380])
    const ear = safeNumber((leftEar + rightEar) / 2, 0)
    const eyesOpen = ear >= EAR_THRESHOLD

    const withinPoseLimits =
      Math.abs(headPose.pitch) <= HEAD_POSE_LIMITS.pitch &&
      Math.abs(headPose.yaw) <= HEAD_POSE_LIMITS.yaw &&
      Math.abs(headPose.roll) <= HEAD_POSE_LIMITS.roll

    const lookingAtScreen = faceDetected && centering.centered && withinPoseLimits && eyesOpen

    const poseScore = 100 - (
      (Math.abs(headPose.pitch) / HEAD_POSE_LIMITS.pitch +
        Math.abs(headPose.yaw) / HEAD_POSE_LIMITS.yaw +
        Math.abs(headPose.roll) / HEAD_POSE_LIMITS.roll) / 3
    ) * 100
    const centerScore = (1 - centering.deviation) * 100
    const eyeScore = eyesOpen ? 100 : 0
    const attentionScore = clamp(
      0.4 * poseScore + 0.35 * centerScore + 0.25 * eyeScore,
      0,
      100
    )

    return {
      success: true,
      face_detected: faceDetected,
      face_count: faceCount,
      multiple_faces: multipleFaces,
      looking_at_screen: lookingAtScreen,
      eyes_open: eyesOpen,
      ear: safeNumber(ear, 0),
      pitch: safeNumber(headPose.pitch, 0),
      yaw: safeNumber(headPose.yaw, 0),
      roll: safeNumber(headPose.roll, 0),
      center_deviation: centering.deviation,
      face_centered: centering.centered,
      confidence: faceDetected ? 1 : 0,
      attention_score: Math.round(attentionScore),
      nose_tip: noseTip ? { x: safeNumber(noseTip.x, 0), y: safeNumber(noseTip.y, 0) } : null,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    console.error('[FaceDetection] Detection error:', error)
    return {
      success: false,
      error: error.message,
      face_detected: false,
      face_count: 0,
      multiple_faces: false,
      timestamp: new Date().toISOString()
    }
  }
}

// Compatibility wrapper for legacy hooks using camelCase fields.
export async function detectFaces(videoElement) {
  const result = await analyzeFrame(videoElement)
  return {
    success: result.success,
    error: result.error,
    faceDetected: result.face_detected,
    multipleFaces: result.multiple_faces,
    faceCount: result.face_count,
    attentionScore: result.attention_score || 0,
    timestamp: result.timestamp
  }
}

function createEngagementState() {
  const recentValidFrames = []
  const recentEarValues = []
  let lastFaceSeenAt = null
  let lastBlinkAt = null
  let lastEarWasClosed = false
  let lastNosePosition = null
  let lastMovementAt = null
  let noMovementFrames = 0

  const pushWindow = (list, value, max) => {
    list.push(value)
    if (list.length > max) list.shift()
  }

  const variance = (values) => {
    if (!values.length) return 0
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  }

  return {
    update(metrics, now) {
      const timestampMs = now instanceof Date ? now.getTime() : now
      const hasFace = metrics.face_detected
      const eyesOpen = metrics.eyes_open
      const lookingAtScreen = metrics.looking_at_screen
      const validFrame = Boolean(hasFace && lookingAtScreen)

      if (hasFace) {
        lastFaceSeenAt = timestampMs
      }

      pushWindow(recentValidFrames, validFrame, 3)
      const validCount = recentValidFrames.filter(Boolean).length
      const stableAttention = validCount >= 2

      if (Number.isFinite(metrics.ear)) {
        pushWindow(recentEarValues, metrics.ear, 15)
      }

      let blinkDetected = false
      if (eyesOpen) {
        if (lastEarWasClosed && (!lastBlinkAt || timestampMs - lastBlinkAt > 200)) {
          blinkDetected = true
          lastBlinkAt = timestampMs
        }
        lastEarWasClosed = false
      } else {
        lastEarWasClosed = true
      }

      if (hasFace && metrics.face_centered) {
        const nose = metrics._nose || null
        if (nose) {
          if (lastNosePosition) {
            const movement = Math.hypot(nose.x - lastNosePosition.x, nose.y - lastNosePosition.y)
            if (movement < 0.002) {
              noMovementFrames += 1
            } else {
              noMovementFrames = 0
              lastMovementAt = timestampMs
            }
          }
          lastNosePosition = nose
        }
      }

      const earVariance = variance(recentEarValues)
      const antiSpoofFlags = []

      if (metrics.multiple_faces) {
        antiSpoofFlags.push('multiple_faces_detected')
      }

      if (noMovementFrames >= 6 && earVariance < 0.0002) {
        antiSpoofFlags.push('static_image_suspected')
      }

      if (recentEarValues.length >= 8 && earVariance < 0.0001) {
        antiSpoofFlags.push('low_ear_variance')
      }

      const graceActive = !hasFace && lastFaceSeenAt && (timestampMs - lastFaceSeenAt) < GRACE_PERIOD_MS

      return {
        stable_attention: stableAttention,
        valid_frames: validCount,
        grace_active: graceActive,
        blink_detected: blinkDetected,
        anti_spoof_flags: antiSpoofFlags,
        ear_variance: earVariance
      }
    }
  }
}

export function createFaceTracker(videoElement, onDetection, intervalMs = 3000) {
  let intervalId = null
  let isRunning = false
  let isPaused = false
  let busy = false
  const engagementState = createEngagementState()

  const runDetection = async () => {
    if (!isRunning || isPaused || busy) return
    busy = true

    const result = await analyzeFrame(videoElement)
    const now = Date.now()

    if (result.success) {
      const noseTip = result.face_detected ? result.nose_tip : null
      const enriched = {
        ...result,
        _nose: noseTip
      }
      const state = engagementState.update(enriched, now)
      if (onDetection && isRunning) {
        onDetection({
          ...result,
          ...state,
          timestamp_ms: now
        })
      }
    } else if (onDetection && isRunning) {
      onDetection({
        ...result,
        timestamp_ms: now
      })
    }

    busy = false
  }

  const start = async () => {
    if (isRunning) return true
    const loaded = await loadFaceDetectionModels()
    if (!loaded) {
      console.error('[FaceTracker] Cannot start - models not loaded')
      return false
    }
    isRunning = true
    isPaused = false
    await runDetection()
    intervalId = setInterval(runDetection, intervalMs)
    console.log('[FaceTracker] Started with interval:', intervalMs, 'ms')
    return true
  }

  const stop = () => {
    isRunning = false
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    console.log('[FaceTracker] Stopped')
  }

  const pause = () => {
    isPaused = true
    console.log('[FaceTracker] Paused')
  }

  const resume = () => {
    isPaused = false
    console.log('[FaceTracker] Resumed')
  }

  return {
    start,
    stop,
    pause,
    resume,
    isRunning: () => isRunning,
    isPaused: () => isPaused
  }
}

export function generateAttendanceMetadata(studentId, classId, detection) {
  return {
    student_id: studentId,
    class_id: classId,
    face_detected: detection.face_detected,
    looking_at_screen: detection.looking_at_screen,
    stable_attention: detection.stable_attention,
    face_centered: detection.face_centered,
    center_deviation: detection.center_deviation,
    pitch: detection.pitch,
    yaw: detection.yaw,
    roll: detection.roll,
    ear: detection.ear,
    eyes_open: detection.eyes_open,
    face_count: detection.face_count || 0,
    multiple_faces: detection.multiple_faces || false,
    blink_detected: detection.blink_detected || false,
    anti_spoof_flags: detection.anti_spoof_flags || [],
    confidence: detection.confidence || 0,
    timestamp: detection.timestamp || new Date().toISOString(),
      attention_score: detection.attention_score || 0,
    processing_location: 'client-side',
    detection_method: 'mediapipe-face-mesh'
  }
}

export default {
  loadFaceDetectionModels,
  detectFaces,
  analyzeFrame,
  createFaceTracker,
  generateAttendanceMetadata
}
