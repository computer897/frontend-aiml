import { useState, useEffect } from 'react'
import { Users, Radio, Eye, EyeOff, AlertTriangle, RefreshCw, Wifi, WifiOff } from 'lucide-react'

/**
 * FIXED: LiveEngagementPanel - Proper engagement monitoring
 *
 * KEY CHANGES:
 * - Now uses 'attention' field instead of counting faceDetected
 * - Correct counting: Focused → Present, Distracted → Warning, Absent → Absent
 * - Shows which students are actually paying attention
 * - Prevents marking distracted students as "Present"
 *
 * Data structure expected:
 * {
 *   attention: "focused" | "distracted" | "absent",
 *   is_active: boolean,
 *   student_name: string,
 *   ...
 * }
 */
function LiveEngagementPanel({
  students = [],
  isActive = false,
  onRefresh,
  lastUpdated,
  error
}) {
  const [searchQuery, setSearchQuery] = useState('')

  // Filter students based on search
  const filteredStudents = students.filter(student =>
    student.student_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    student.section?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // *** FIXED COUNTING LOGIC ***
  // Now counts based on ATTENTION field, not just face_detected
  const totalStudents = students.length
  const focusedCount = students.filter(s => s.attention === 'focused').length
  const distractedCount = students.filter(s => s.attention === 'distracted').length
  const absentCount = students.filter(s => s.attention === 'absent').length
  const noSignalCount = students.filter(s => s.attention === 'no_signal' || s.camera_state === 'disabled').length

  // Status info based on ATTENTION field
  const getStatusInfo = (student) => {
    if (!student.is_active) {
      return {
        dotColor: 'bg-gray-400',
        ringColor: 'ring-gray-200',
        label: 'Offline',
        textColor: 'text-gray-500',
        backgroundColor: 'bg-gray-50'
      }
    }

    const attention = student.attention || (student.camera_state === 'disabled' ? 'no_signal' : 'absent')
    // *** KEY FIX: Use attention field, not face_detected ***
    switch (attention) {
      case 'no_signal':
        return {
          dotColor: 'bg-gray-400',
          ringColor: 'ring-gray-200',
          label: 'No signal',
          textColor: 'text-gray-500',
          backgroundColor: 'bg-gray-50 dark:bg-gray-900/20'
        }
      case 'focused':
        return {
          dotColor: 'bg-green-500',
          ringColor: 'ring-green-200',
          label: 'Focused',
          textColor: 'text-green-600',
          backgroundColor: 'bg-green-50 dark:bg-green-900/10'
        }
      case 'distracted':
        return {
          dotColor: 'bg-amber-500',
          ringColor: 'ring-amber-200',
          label: 'Distracted',
          textColor: 'text-amber-600',
          backgroundColor: 'bg-amber-50 dark:bg-amber-900/10'
        }
      case 'absent':
      default:
        return {
          dotColor: 'bg-red-500',
          ringColor: 'ring-red-200',
          label: 'Absent',
          textColor: 'text-red-600',
          backgroundColor: 'bg-red-50 dark:bg-red-900/10'
        }
    }
  }

  if (!isActive) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
            <WifiOff className="w-5 h-5 text-gray-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Live Engagement</h3>
            <p className="text-sm text-gray-500">No active class session</p>
          </div>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">
          Start a class session to see real-time student engagement
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
              <Radio className="w-5 h-5 text-green-600 animate-pulse" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Live Engagement</h3>
              <p className="text-xs text-gray-500">
                {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : 'Connecting...'}
              </p>
            </div>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {/* *** FIXED SUMMARY STATS *** */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <p className="text-lg font-bold text-gray-900 dark:text-white">{totalStudents}</p>
            <p className="text-[10px] text-gray-500">Total</p>
          </div>
          <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <p className="text-lg font-bold text-green-600">{focusedCount}</p>
            <p className="text-[10px] text-green-600">Focused</p>
          </div>
          <div className="text-center p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <p className="text-lg font-bold text-amber-600">{distractedCount}</p>
            <p className="text-[10px] text-amber-600">Distracted</p>
          </div>
          <div className="text-center p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-lg font-bold text-red-600">{absentCount}</p>
            <p className="text-[10px] text-red-600">Absent</p>
          </div>
          <div className="text-center p-2 bg-gray-50 dark:bg-gray-900/20 rounded-lg">
            <p className="text-lg font-bold text-gray-500">{noSignalCount}</p>
            <p className="text-[10px] text-gray-500">No signal</p>
          </div>
        </div>

        {/* Search */}
        {totalStudents > 5 && (
          <input
            type="text"
            placeholder="Search students..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400"
          />
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-600 text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Student List */}
      <div className="p-4 max-h-[400px] overflow-y-auto">
        {filteredStudents.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {searchQuery ? 'No students match your search' : 'Waiting for students to join...'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredStudents.map((student) => {
              const status = getStatusInfo(student)
              return (
                <div
                  key={student.student_id}
                  className={`flex items-center justify-between p-3 rounded-xl hover:opacity-80 transition ${status.backgroundColor}`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    {/* Status Dot with pulse animation */}
                    <div className="relative">
                      <span className={`w-3 h-3 rounded-full ${status.dotColor} block`} />
                      {student.is_active && student.attention !== 'absent' && (
                        <span className={`absolute inset-0 w-3 h-3 rounded-full ${status.dotColor} animate-ping opacity-75`} />
                      )}
                    </div>

                    {/* Student Info */}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                        {student.student_name}
                      </p>
                      <p className="text-[11px] text-gray-600 dark:text-gray-400">
                        {student.section || 'No section'} · {status.label}
                      </p>
                    </div>
                  </div>

                  {/* Attention Indicators */}
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${status.textColor}`}>
                      {Math.round(student.engagement_percentage || 0)}%
                    </p>
                    <div className="flex items-center gap-1 mt-1">
                      {student.attention === 'focused' ? (
                        <Eye className="w-3 h-3 text-green-600" />
                      ) : student.attention === 'distracted' ? (
                        <EyeOff className="w-3 h-3 text-amber-600" />
                      ) : (
                        <span className="text-[9px] text-gray-400">—</span>
                      )}
                      {student.face_count > 1 && (
                        <span className="text-[9px] px-1 py-0.5 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded">
                          Multiple faces
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
          <p className="font-semibold text-gray-900 dark:text-gray-200 mb-2">Status Legend:</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span>Focused = Present & engaged</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Distracted = Present but not paying attention</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span>Absent = No face detected</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              <span>Offline = Not connected</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LiveEngagementPanel
