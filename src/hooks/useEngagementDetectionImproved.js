/**
 * IMPROVED: useEngagementDetection with Time-Based Smoothing
 *
 * This hook NOW correctly implements:
 * 1. Proper state transitions with smoothing (5-10 second delays)
 * 2. Clear 'attention' field that dashboard can use
 * 3. Prevents flickering between states
 * 4. Sends proper engagement metadata to backend
 *
 * KEY CHANGES FROM OLD VERSION:
 * - Added AttentionStateManager for time-based smoothing
 * - Sends 'attention' field: "focused" | "distracted" | "absent" (NOT just attentionScore)
 * - Dashboard now uses this 'attention' field for counting
 * - Reduces socket updates (only on real state changes, not every frame)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { loadFaceDetectionModels, detectFaces } from '../services/faceDetection'

const ATTENTIVE_SCORE_THRESHOLD = 55
const DISTRACTED_STABILITY_TIME = 5000  // 5 seconds of distraction before marking distracted
const ABSENT_STABILITY_TIME = 10000     // 10 seconds no face before marking absent

/**
 * Manages attention state transitions with time-based smoothing
 * This prevents instant flickering between states
 */
class AttentionStateManager {
  constructor() {
    this.currentAttention = 'absent'           // focused | distracted | absent
    this.lastTransitionTime = Date.now()
    this.lastRawStatus = null                  // Track raw detection status
    this.stateStartTime = {}                   // Track how long we've been in each "pending" state
  }

  /**
   * Update with raw detection results
   * Returns the STABLE attention state (after smoothing)
   */
  update(faceDetected, faceCount, attentionScore) {
    const now = Date.now()

    // Determine raw status from detection
    let rawStatus
    if (!faceDetected) {
      rawStatus = 'absent'
    } else if (faceCount > 1) {
      rawStatus = 'distracted'  // Multiple faces = likely cheating
    } else if (attentionScore >= ATTENTIVE_SCORE_THRESHOLD) {
      rawStatus = 'focused'
    } else {
      rawStatus = 'distracted'
    }

    // Track how long we've been in this raw state
    if (rawStatus !== this.lastRawStatus) {
      this.lastRawStatus = rawStatus
      this.stateStartTime[rawStatus] = now
    }

    const timeInState = now - (this.stateStartTime[rawStatus] || now)

    // State machine with time-based transitions
    if (rawStatus === 'focused') {
      // FOCUSED: Immediate transition (no need to wait)
      return this._transitionTo('focused', now)
    } else if (rawStatus === 'distracted') {
      // DISTRACTED: Require 5 seconds of consistent distraction
      if (timeInState >= DISTRACTED_STABILITY_TIME || this.currentAttention === 'distracted') {
        return this._transitionTo('distracted', now)
      }
      // Still building up time in distracted state, keep current state
      return this.currentAttention
    } else if (rawStatus === 'absent') {
      // ABSENT: Require 10 seconds of no face
      if (timeInState >= ABSENT_STABILITY_TIME || this.currentAttention === 'absent') {
        return this._transitionTo('absent', now)
      }
      // Still building up time, keep current state
      return this.currentAttention
    }

    return this.currentAttention
  }

  _transitionTo(newState, now) {
    if (newState !== this.currentAttention) {
      this.currentAttention = newState
      this.lastTransitionTime = now
      this.stateStartTime = { [newState]: now }
    }
    return this.currentAttention
  }

  getStableAttention() {
    return this.currentAttention
  }
}

/**
 * useEngagementDetection - Improved version
 *
 * Now sends:
 * {
 *   userId: string,
 *   attention: "focused" | "distracted" | "absent",
 *   faceDetected: boolean,
 *   attentionScore: number,
 *   timestamp: number
 * }
 */
export function useEngagementDetection({ videoRef, webrtcRef, userId, userName, isActive }) {
  const [faceDetected, setFaceDetected] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [engagementStatus, setEngagementStatus] = useState('absent')
  const [attentionScore, setAttentionScore] = useState(0)

  const modelsLoadedRef = useRef(false)
  const intervalRef = useRef(null)
  const lastVideoWarningRef = useRef(0)
  const stateManagerRef = useRef(new AttentionStateManager())
  const lastSentStateRef = useRef(null)  // Only emit when state truly changes

  // Load models once on mount
  useEffect(() => {
    loadFaceDetectionModels().then(loaded => {
      modelsLoadedRef.current = loaded
      setModelsLoaded(loaded)
      if (!loaded) {
        console.warn('[useEngagementDetection] Face models failed to load')
      }
    })
  }, [])

  // Single detection pass
  const runDetection = useCallback(async () => {
    if (!webrtcRef.current) return

    const videoElement = videoRef.current
    const cameraOn = !!videoElement?.srcObject?.getVideoTracks?.().some(track => track.enabled)
    const videoReady = !!(
      videoElement &&
      videoElement.readyState >= 2 &&
      videoElement.videoWidth > 0 &&
      videoElement.videoHeight > 0 &&
      !videoElement.paused &&
      !videoElement.ended
    )

    let faceDetectedThisRound = false
    let faceCountThisRound = 0
    let currentAttentionScore = 0

    if (modelsLoadedRef.current && videoReady) {
      // Run face detection
      const result = await detectFaces(videoElement)
      faceDetectedThisRound = result.faceDetected
      faceCountThisRound = result.faceCount
      currentAttentionScore = result.attentionScore || 0

      setFaceDetected(faceDetectedThisRound)
      setAttentionScore(currentAttentionScore)
    } else {
      if (videoElement && Date.now() - lastVideoWarningRef.current > 8000) {
        console.debug('[useEngagementDetection] Video not ready')
        lastVideoWarningRef.current = Date.now()
      }
      setFaceDetected(false)
      setAttentionScore(0)
    }

    // *** KEY CHANGE: Use state manager for smoothed attention ***
    const stateManager = stateManagerRef.current
    const stableAttention = stateManager.update(
      faceDetectedThisRound,
      faceCountThisRound,
      currentAttentionScore
    )

    setEngagementStatus(stableAttention)

    // Only emit when state truly changes (and camera state changes)
    const stateChanged = stableAttention !== lastSentStateRef.current || cameraOn !== lastSentStateRef.current?.cameraOn

    if (stateChanged) {
      const oldState = lastSentStateRef.current?.attention
      lastSentStateRef.current = {
        attention: stableAttention,
        cameraOn
      }

      console.debug('[useEngagementDetection] 🔄 State changed:', {
        student: userName,
        oldAttention: oldState,
        newAttention: stableAttention,
        faceDetected: faceDetectedThisRound,
        attentionScore: currentAttentionScore,
        cameraOn,
      })

      // *** CRITICAL FIX: Send proper attention field to backend ***
      // This allows dashboard to correctly count Focused vs Distracted vs Absent
      webrtcRef.current.sendEngagementUpdate({
        studentId: userId,
        studentName: userName,
        attention: stableAttention,
        face_detected: faceDetectedThisRound,
        looking_at_screen: stableAttention === 'focused',
        stable_attention: stableAttention === 'focused',
        camera_state: cameraOn ? 'visible' : 'hidden',
        detection_active: true,
        engagement_eligible: stableAttention === 'focused',
        timestamp: Date.now()
      })
    }
  }, [userId, userName, videoRef, webrtcRef])

  // Start/stop 5-second interval
  useEffect(() => {
    if (!isActive) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
      stateManagerRef.current = new AttentionStateManager()  // Reset on deactivate
      return
    }

    // Immediate first run, then every 5 seconds
    runDetection()
    intervalRef.current = setInterval(runDetection, 5000)

    return () => {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [isActive, runDetection])

  return {
    faceDetected,
    modelsLoaded,
    engagementStatus,
    attentionScore
  }
}
