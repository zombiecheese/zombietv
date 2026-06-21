// Utility functions for scheduling logic
// Time calculations, genre filtering, etc.

import { format, parseISO } from 'date-fns'

export const getTimeSlot = (currentHour: number) => {
  return {
    start: `${currentHour.toString().padStart(2, '0')}:00`,
    end: `${(currentHour + 1).toString().padStart(2, '0')}:00`
  }
}

export const getCurrentHour = () => {
  return new Date().getHours()
}

export const isPrimeTime = (hour: number) => {
  // Prime time: 19:00 - 23:00
  return hour >= 19 && hour < 23
}

export const isDaytime = (hour: number) => {
  // Daytime: 06:00 - 18:00
  return hour >= 6 && hour < 18
}

export const isLateNight = (hour: number) => {
  // Late night: 23:00 - 05:00
  return hour >= 23 || hour < 5
}

export const formatDateForDisplay = (date: Date) => {
  return format(date, 'EEEE, MMMM d, yyyy')
}

export const formatTimeForDisplay = (hour: number) => {
  return `${hour.toString().padStart(2, '0')}:00`
}

// Genre filtering logic
export const filterContentByGenre = (content: any[], allowedGenres: string[]) => {
  return content.filter((item: any) =>
    item.genres.some((genre: string) => allowedGenres.includes(genre))
  )
}

export const filterContentByRating = (content: any[], rating: string) => {
  return content.filter(item => 
    item.ratings?.includes(rating) || !item.ratings
  )
}

// Ad break calculations
export const insertAdBreak = (programDuration: number, adInterval: number) => {
  // Insert ad breaks at specified intervals
  const adBreaks: Array<{ start: number; duration: number }> = []
  
  for (let i = adInterval; i < programDuration; i += adInterval) {
    adBreaks.push({
      start: i,
      duration: 15 // Standard 15-minute ad break
    })
  }
  
  return adBreaks
}

// Holiday date calculations
export const isHoliday = (date: Date): string | null => {
  const month = date.getMonth() + 1
  const day = date.getDate()
  
  // Christmas Day
  if (month === 12 && day === 25) return 'christmas'
  // Christmas Eve
  if (month === 12 && day === 24) return 'christmas_eve'
  // Good Friday (approximate - needs calendar lookup for exact date)
  if (month === 3 || month === 4) return null // Easter period
  // Halloween
  if (month === 10 && day === 31) return 'halloween'
  
  return null
}

// Time alignment to hour/half-hour
export const alignToHour = (timestamp: Date) => {
  const newDate = new Date(timestamp)
  newDate.setMinutes(0, 0, 0)
  return newDate
}

export const alignToHalfHour = (timestamp: Date) => {
  const newDate = new Date(timestamp)
  newDate.setMinutes(Math.round(newDate.getMinutes() / 30) * 30, 0, 0)
  return newDate
}

// Weighted random selection
export const weightedRandomSelect = (items: Array<{ weight: number; content: any }>) => {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
  let random = Math.random() * totalWeight
  
  for (const item of items) {
    if (random < item.weight) {
      return item.content
    }
    random -= item.weight
  }
  
  return items[items.length - 1].content // Fallback
}

// Calculate program progress
export const getProgramProgress = (program: any, currentTime: Date) => {
  const startTime = parseISO(program.startTime)
  const duration = program.duration || 60 // Default 60 minutes
  
  const elapsed = currentTime.getTime() - startTime.getTime()
  const totalDuration = duration * 60 * 1000 // Convert to milliseconds
  
  return Math.min(Math.max(elapsed / totalDuration, 0), 1)
}

// Get next transition time
export const getNextTransition = (program: any) => {
  const startTime = parseISO(program.startTime)
  const duration = program.duration || 60
  
  const nextProgramStart = new Date(startTime.getTime() + duration * 60 * 1000)
  
  return nextProgramStart
}
