'use client'
// 08 4.11 / 6.3. The value is always Japan time, independent of the browser time zone; toInput converts it with jstInputToIso.
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isoToJstInput } from '@/lib/datetime'
import { FieldError } from './form-message'

export function DateTimeField({
  name,
  label,
  defaultIso = null,
  required = false,
  clearable = false,
  error,
}: {
  name: string
  label: string
  /** DTO value (UTC ISO). Converted to a Japan-time input value. */
  defaultIso?: string | null
  required?: boolean
  clearable?: boolean
  error?: string
}) {
  const [value, setValue] = useState(isoToJstInput(defaultIso))
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}（日本時間）</Label>
      <div className="flex items-center gap-2">
        <Input
          id={name}
          name={name}
          type="datetime-local"
          step={60}
          required={required}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${name}-error` : undefined}
        />
        {clearable ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setValue('')}>
            クリア
          </Button>
        ) : null}
      </div>
      <FieldError name={name} message={error} />
    </div>
  )
}
