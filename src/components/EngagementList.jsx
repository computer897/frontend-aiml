import { AlertCircle, CheckCircle, X, Radio } from 'lucide-react'

function EngagementList({ students, onSelectStudent }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'border-green-500 bg-green-900/30'
      case 'distracted':
        return 'border-yellow-500 bg-yellow-900/30'
      case 'inactive':
      case 'absent':
        return 'border-red-500 bg-red-900/30'
      default:
        return 'border-gray-600 bg-gray-800'
    }
  }

  const getEngagementColor = (engagement) => {
    if (engagement >= 80) return 'text-green-400'
    if (engagement >= 50) return 'text-yellow-400'
    if (engagement > 0) return 'text-red-400'
    return 'text-gray-500'
  }

  const sortedStudents = [...students].sort((a, b) => {
    if (a.status === 'distracted' && b.status !== 'distracted') return -1
    if (a.status !== 'distracted' && b.status === 'distracted') return 1
    return b.engagement - a.engagement
  })

  return (
    <div className="flex flex-col h-full bg-gray-800">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-white">Student Engagement</h3>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-green-600/20 border border-green-600/40 rounded-full">
            <Radio className="w-3 h-3 text-green-400 animate-pulse" />
            <span className="text-green-400 text-[10px] font-semibold">LIVE</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-gray-400">Active</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            <span className="text-gray-400">Distracted</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
            <span className="text-gray-400">Inactive</span>
          </div>
        </div>
      </div>

      {/* Students List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sortedStudents.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">No students connected yet</p>
            <p className="text-gray-600 text-xs mt-1">Engagement data will appear when students join</p>
          </div>
        ) : (
          sortedStudents.map((student) => (
            <div
              key={student.id}
              className={`border-l-4 rounded-lg p-3 transition cursor-pointer hover:bg-gray-700/50 ${getStatusColor(student.status)}`}
              onClick={() => onSelectStudent && onSelectStudent(student)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs font-semibold">
                      {student.avatar || student.name?.split(' ').map(n => n[0]).join('') || '?'}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-white">{student.name}</span>
                </div>
                {student.status === 'distracted' && (
                  <AlertCircle className="w-4 h-4 text-yellow-400" />
                )}
                {student.status === 'active' && student.engagement >= 80 && (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${getEngagementColor(student.engagement)}`}>
                  {student.engagement}% engaged
                </span>
                <span className="text-xs text-gray-500 capitalize">{student.status}</span>
              </div>

              {/* Progress Bar */}
              <div className="mt-2 w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    student.engagement >= 80
                      ? 'bg-green-500'
                      : student.engagement >= 50
                      ? 'bg-yellow-500'
                      : student.engagement > 0
                      ? 'bg-red-500'
                      : 'bg-gray-600'
                  }`}
                  style={{ width: `${student.engagement}%` }}
                />
              </div>

              {/* Looking at screen indicator */}
              {student.lookingAtScreen !== undefined && (
                <div className="mt-2 flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${student.lookingAtScreen ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className="text-[10px] text-gray-500">
                    {student.lookingAtScreen ? 'Looking at screen' : 'Not looking at screen'}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default EngagementList
