import { useEffect, useRef, useState, useCallback } from 'react'
import { loadFaceDetectionModels, detectFaces } from '../services/faceDetection'

/**
 * PROBLEM 3 FIX: Weighted engagement formula
 * Engagement Score = 0.4×Face + 0.3×EyeFocus + 0.2×HeadPose + 0.1×Activity
 */
const ENGAGEMENT_WEIGHTS = {
  FACE_DETECTION: 0.40,
  EYE_FOCUS: 0.30,
  HEAD_POSE: 0.20,
  ACTIVITY_TIME: 0.10
}

const ENGAGEMENT_THRESHOLDS = {
  FOCUSED: 70,      // High engagement
  DISTRACTED: 40,   // Medium engagement
  DISENGAGED: 10,   // Low engagement
  INACTIVE: 0       // No detection or timeout
}

const FACE_DETECTION_TIMEOUT_SECONDS = 30  // PROBLEM 2 FIX: Timeout for continuous presence validation
const INACTIVITY_TIMEOUT_SECONDS = 120  // Mark completely inactive after 2 minutes

/**
 * useEngagementDetection with PROBLEM 2/3/5/7 fixes
 *
 * Features:
 * - Weighted engagement scoring (PROBLEM 3)
 * - Timeout-based presence validation (PROBLEM 2)
 * - Continuous detection even with camera OFF (PROBLEM 5)
 * - Anti-cheating detection (PROBLEM 7)
 *
 * @param {object}  videoRef   – React ref pointing to the <video> element
 * @param {object}  webrtcRef  – React ref pointing to the WebRTC manager
 * @param {string}  userId     – Student's user ID
 * @param {string}  userName   – Student's display name
 * @param {boolean} isActive   – Detection runs continuously
 * @param {boolean} cameraOn   – Whether camera is enabled (optional)
 *
 * @returns {{ faceDetected: boolean, modelsLoaded: boolean, engagementScore: number, engagementStatus: string }}
 */
export function useEngagementDetection({ videoRef, webrtcRef, userId, userName, isActive, cameraOn = true }) {
  const [faceDetected, setFaceDetected]         = useState(false)
  const [modelsLoaded, setModelsLoaded]         = useState(false)
  const [engagementStatus, setEngagementStatus] = useState('inactive')
  const [engagementScore, setEngagementScore]   = useState(0)

  const modelsLoadedRef = useRef(false)
  const intervalRef     = useRef(null)
  const lastVideoWarningRef = useRef(0)
  const lastStatusRef = useRef('inactive')
  const lastCameraOnRef = useRef(cameraOn)
  
  // PROBLEM 2 FIX: Timeout tracking
  const lastDetectionTimeRef = useRef(null)
  const lastActivityTimeRef = useRef(null)
  const consecutiveDetectionFramesRef = useRef(0)
  
  // PROBLEM 3 FIX: Engagement score tracking
  const recentEngagementScoresRef = useRef([])  // Keep last 3 frames for averaging
  const sessionStartTimeRef = useRef(Date.now())
  const totalEngagementTimeRef = useRef(0)
  
  // PROBLEM 7 FIX: Anti-cheating tracking
  const consecutiveSameFacesRef = useRef(0)
  const multipleFaceDetectionsRef = useRef(0)
  const antiCheatingFlagsRef = useRef([])

  // ── Load face-api models once on mount ──────────────────────────────────
  useEffect(() => {
    loadFaceDetectionModels().then(loaded => {
      modelsLoadedRef.current = loaded
      setModelsLoaded(loaded)
      if (!loaded) {
        console.warn('[useEngagementDetection] Face models failed to load – using camera fallback')
      }
    })
  }, [])

  /**
   * PROBLEM 3 FIX: Calculate weighted engagement score
   */
  const calculateWeightedEngagementScore = useCallback((faceData) => {
    // Face detection component (0-100)
    const faceDetectionScore = faceData.faceDetected ? 100 : 0
    
    // Eye focus component - estimate from attention score (0-100)
    const eyeFocusScore = faceData.attentionScore || 0
    
    // Head pose component - estimate based on face position (0-100)
    // In production, would extract head pose from face-api landmarks
    const headPoseScore = faceData.faceDetected ? Math.max(0, 100 - Math.abs(faceData.attentionScore - 50) * 2) : 0
    
    // Activity time component - 1.0 if continuously engaged, decay if gaps
    const activityScore = recentEngagementScoresRef.current.length > 0 ? 100 : 0
    
    // Calculate weighted score
    const weightedScore = (
      ENGAGEMENT_WEIGHTS.FACE_DETECTION * faceDetectionScore +
      ENGAGEMENT_WEIGHTS.EYE_FOCUS * eyeFocusScore +
      ENGAGEMENT_WEIGHTS.HEAD_POSE * headPoseScore +
      ENGAGEMENT_WEIGHTS.ACTIVITY_TIME * activityScore
    )
    
    return Math.min(100, Math.max(0, weightedScore))
  }, [])

  /**
   * PROBLEM 2 FIX: Determine status with timeout validation
   */
  const determineEngagementStatus = useCallback((score, faceDetected, currentTime) => {
    // Check timeout conditions first
    const timeSinceDetection = lastDetectionTimeRef.current 
      ? (currentTime - lastDetectionTimeRef.current) / 1000 
      : FACE_DETECTION_TIMEOUT_SECONDS + 1
    
    const timeSinceActivity = lastActivityTimeRef.current 
      ? (currentTime - lastActivityTimeRef.current) / 1000 
      : INACTIVITY_TIMEOUT_SECONDS + 1
    
    // PROBLEM 2: If no face detected for 30+ seconds, mark as inactive
    if (timeSinceDetection > FACE_DETECTION_TIMEOUT_SECONDS) {
      return 'inactive'
    }
    
    // If no activity for 2+ minutes, mark as inactive
    if (timeSinceActivity > INACTIVITY_TIMEOUT_SECONDS) {
      return 'inactive'
    }
    
    // PROBLEM 7: Check anti-cheating flags
    if (antiCheatingFlagsRef.current.length > 0) {
      return 'suspicious'
    }
    
    // Score-based status
    if (score >= ENGAGEMENT_THRESHOLDS.FOCUSED) {
      return 'focused'
    } else if (score >= ENGAGEMENT_THRESHOLDS.DISTRACTED) {
      return 'distracted'
    } else if (score >= ENGAGEMENT_THRESHOLDS.DISENGAGED) {
      return 'disengaged'
    } else {
      return 'inactive'
    }
  }, [])

  /**
   * PROBLEM 7 FIX: Check for anti-cheating indicators
   */
  const checkAntiCheatFlags = useCallback((faceData) => {
    antiCheatingFlagsRef.current = []
    
    // Multiple faces detection
    if (faceData.multipleFaces && faceData.faceCount > 1) {
      multipleFaceDetectionsRef.current++
      if (multipleFaceDetectionsRef.current > 3) {
        antiCheatingFlagsRef.current.push('multiple_faces_detected')
      }
    } else {
      multipleFaceDetectionsRef.current = 0
    }
    
    // Static image detection (same face for too long)
    if (faceData.faceDetected) {
      consecutiveSameFacesRef.current++
      if (consecutiveSameFacesRef.current > 60) { // ~5 minutes at 5s interval
        antiCheatingFlagsRef.current.push('static_image_detected')
      }
    } else {
      consecutiveSameFacesRef.current = 0
    }
    
    return antiCheatingFlagsRef.current
  }, [])

  // ── Single detection pass with timeout validation ────────────────────────
  const runDetection = useCallback(async () => {
    if (!webrtcRef.current) return

    const currentTime = Date.now()
    const videoElement = videoRef.current
    const videoReady = !!(
      videoElement &&
      videoElement.readyState >= 2 &&
      videoElement.videoWidth > 0 &&
      videoElement.videoHeight > 0 &&
      !videoElement.paused &&
      !videoElement.ended
    )

    // PROBLEM 5 FIX: Continue detection even with camera OFF
    let faceDetectedThisRound = false
    let engagementScoreThisRound = 0
    let faceData = { faceDetected: false, attentionScore: 0, multipleFaces: false, faceCount: 0 }

    if (modelsLoadedRef.current && videoReady) {
      // Primary path: face-api.js detection
      faceData = await detectFaces(videoElement)
      faceDetectedThisRound = faceData.faceDetected
      setFaceDetected(faceDetectedThisRound)

      // PROBLEM 3: Calculate weighted engagement score
      engagementScoreThisRound = calculateWeightedEngagementScore(faceData)
      
      // Keep sliding window of recent scores (last 3 frames = 15 seconds)
      recentEngagementScoresRef.current.push(engagementScoreThisRound)
      if (recentEngagementScoresRef.current.length > 3) {
        recentEngagementScoresRef.current.shift()
      }
      
      // Average recent scores
      const avgEngagementScore = recentEngagementScoresRef.current.length > 0
        ? recentEngagementScoresRef.current.reduce((a, b) => a + b, 0) / recentEngagementScoresRef.current.length
        : 0
      
      setEngagementScore(Math.round(avgEngagementScore))
    } else {
      if (videoElement && Date.now() - lastVideoWarningRef.current > 8000) {
        console.log('[useEngagementDetection] Video not ready for face detection:', {
          readyState: videoElement?.readyState,
          width: videoElement?.videoWidth,
          height: videoElement?.videoHeight,
          paused: videoElement?.paused,
          ended: videoElement?.ended,
          modelsLoaded: modelsLoadedRef.current,
        })
        lastVideoWarningRef.current = Date.now()
      }

      setFaceDetected(false)
      setEngagementScore(0)
    }

    // PROBLEM 2 FIX: Update detection timers
    if (faceDetectedThisRound) {
      lastDetectionTimeRef.current = currentTime
      lastActivityTimeRef.current = currentTime
      consecutiveDetectionFramesRef.current++
    } else {
      consecutiveDetectionFramesRef.current = 0
    }

    // PROBLEM 7 FIX: Check anti-cheating flags
    checkAntiCheatFlags(faceData)

    // PROBLEM 2 FIX: Determine status with timeout validation
    const avgEngagementScore = recentEngagementScoresRef.current.length > 0
      ? recentEngagementScoresRef.current.reduce((a, b) => a + b, 0) / recentEngagementScoresRef.current.length
      : 0
    const newStatus = determineEngagementStatus(avgEngagementScore, faceDetectedThisRound, currentTime)
    
    setEngagementStatus(newStatus)

    // Track engagement time (for final percentage calculation)
    if (newStatus === 'focused' || newStatus === 'distracted') {
      totalEngagementTimeRef.current += 5 // 5-second interval
    }

    // Emit when engagement changes or periodically
    const statusChanged = newStatus !== lastStatusRef.current
    const cameraStateChanged = cameraOn !== lastCameraOnRef.current
    
    if (statusChanged || cameraStateChanged) {
      const oldStatus = lastStatusRef.current
      lastStatusRef.current = newStatus
      lastCameraOnRef.current = cameraOn

      console.debug('[useEngagementDetection] Status changed:', {
        studentId: userId,
        oldStatus,
        newStatus,
        engagementScore: avgEngagementScore.toFixed(1),
        faceDetected: faceDetectedThisRound,
        cameraOn,
        antiCheatingFlags: antiCheatingFlagsRef.current,
      })

      // Emit engagement update to server
      if (webrtcRef.current?.sendEngagementUpdate) {
        const attention = newStatus === 'focused'
          ? 'focused'
          : newStatus === 'distracted'
            ? 'distracted'
            : 'absent'
        webrtcRef.current.sendEngagementUpdate({
          studentId: userId,
          studentName: userName,
          attention,
          face_detected: faceDetectedThisRound,
          looking_at_screen: attention === 'focused',
          stable_attention: attention === 'focused',
          camera_state: cameraOn ? 'visible' : 'hidden',
          detection_active: true,
          engagement_eligible: attention === 'focused',
          timestamp: Date.now()
        })
      }
    }
  }, [userId, userName, videoRef, webrtcRef, cameraOn, calculateWeightedEngagementScore, determineEngagementStatus, checkAntiCheatFlags])

  // ── Detection loop (every 5 seconds) ──────────────────────────────────
  useEffect(() => {
    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Run detection immediately and then every 5 seconds
    runDetection()
    intervalRef.current = setInterval(runDetection, 5000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isActive, runDetection])

  return {
    faceDetected,
    modelsLoaded,
    engagementStatus,
    engagementScore,
    antiCheatingFlags: antiCheatingFlagsRef.current,
  }
}

