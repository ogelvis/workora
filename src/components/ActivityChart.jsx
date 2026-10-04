import { useState } from 'react'

function ActivityChart({ weeks, unit }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(4, ...weeks.map((week) => week.count))
  const step = Math.ceil(max / 4)
  const top = step * 4
  const ticks = [0, step, step * 2, step * 3, top]
  const width = 640
  const height = 180
  const left = 28
  const bottom = 22
  const plotWidth = width - left
  const plotHeight = height - bottom - 8
  const band = plotWidth / weeks.length
  const barWidth = Math.min(24, band * 0.56)
  const total = weeks.reduce((sum, week) => sum + week.count, 0)
  const label = (week) => new Date(`${week}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${unit} per week for the last 12 weeks, ${total} in total`}>
        {ticks.map((tick) => {
          const y = 8 + plotHeight - (tick / top) * plotHeight
          return (
            <g key={tick}>
              <line x1={left} x2={width} y1={y} y2={y} className="chart-grid" />
              <text x={left - 8} y={y + 3.5} textAnchor="end" className="chart-tick">{tick}</text>
            </g>
          )
        })}
        {weeks.map((week, index) => {
          const barHeight = week.count ? Math.max(3, (week.count / top) * plotHeight) : 0
          const x = left + band * index + (band - barWidth) / 2
          const y = 8 + plotHeight - barHeight
          const r = Math.min(4, barHeight / 2)
          const isLast = index === weeks.length - 1
          return (
            <g key={week.week} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
              <rect x={left + band * index} y={0} width={band} height={height - bottom} fill="transparent" />
              {barHeight > 0 && (
                <path
                  className={`chart-bar${isLast ? ' current' : ''}${hover === index ? ' hover' : ''}`}
                  d={`M${x},${y + barHeight} V${y + r} Q${x},${y} ${x + r},${y} H${x + barWidth - r} Q${x + barWidth},${y} ${x + barWidth},${y + r} V${y + barHeight} Z`}
                />
              )}
              {(index % 3 === 2 || isLast) && (
                <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" className="chart-tick">{isLast ? 'This week' : label(week.week)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: `${((left + band * hover + band / 2) / width) * 100}%` }}>
          <strong>{weeks[hover].count} {unit}</strong>
          <span>Week of {label(weeks[hover].week)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{unit} per week</caption>
        <tbody>{weeks.map((week) => <tr key={week.week}><th>{label(week.week)}</th><td>{week.count}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}

export default ActivityChart
