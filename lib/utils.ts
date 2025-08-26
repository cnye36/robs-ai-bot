import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse the date format used in the chat history JSON
 * Format: "Thursday, September 12, 2013 at 3:50:11 PM UTC"
 */
export function parseChatDate(dateString: string | null): string | null {
  if (!dateString) return null
  
  try {
    // Handle the specific format: "Thursday, September 12, 2013 at 3:50:11 PM UTC"
    // First try direct parsing
    let date = new Date(dateString)
    
    // Check if the date is valid
    if (!isNaN(date.getTime())) {
      return date.toISOString()
    }
    
    // If direct parsing fails, try to clean up the format
    // Remove the day of week and "at" to make it more parseable
    const cleanedDateString = dateString
      .replace(/^[A-Za-z]+,\s*/, '') // Remove "Wednesday, "
      .replace(/\s+at\s+/, ' ') // Replace " at " with " "
      .replace(/\s+UTC$/, '') // Remove " UTC" at the end
    
    date = new Date(cleanedDateString)
    
    if (!isNaN(date.getTime())) {
      return date.toISOString()
    }
    
    // If still failing, try a more aggressive cleanup
    const match = dateString.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)/)
    if (match) {
      const [, month, day, year, hour, minute, second, ampm] = match
      const monthIndex = new Date(`${month} 1, 2000`).getMonth()
      let hour24 = parseInt(hour)
      if (ampm === 'PM' && hour24 !== 12) hour24 += 12
      if (ampm === 'AM' && hour24 === 12) hour24 = 0
      
      date = new Date(parseInt(year), monthIndex, parseInt(day), hour24, parseInt(minute), parseInt(second))
      if (!isNaN(date.getTime())) {
        return date.toISOString()
      }
    }
    
    console.warn(`Could not parse date format: ${dateString}`)
    return null
  } catch (error) {
    console.error(`Error parsing date: ${dateString}`, error)
    return null
  }
}

/**
 * Format a date for display in the chat interface
 */
export function formatChatDate(dateString: string | null): string {
  if (!dateString) return "Unknown date"
  
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (error) {
    console.error(`Error formatting date: ${dateString}`, error)
    return "Invalid date"
  }
}
