'use client'

import Image from 'next/image'
import { Building2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { HomeAction, HomeHeroSlide } from '@/lib/home-content'

const AUTO_ADVANCE_MS = 5000
const SWIPE_THRESHOLD_PX = 44

export interface HomeHeroCarouselProps {
  slides: readonly HomeHeroSlide[]
  reducedMotion?: boolean
  onAction?: (action: HomeAction) => void
}

function isSafeLocalImage(src: string | undefined): src is string {
  return Boolean(src && src.startsWith('/') && !src.startsWith('//'))
}

export function HomeHeroCarousel({
  slides,
  reducedMotion = false,
  onAction,
}: HomeHeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [timerReset, setTimerReset] = useState(0)
  const touchStartX = useRef<number | null>(null)

  const slideCount = slides.length
  const visibleIndex = slideCount > 0 ? Math.min(activeIndex, slideCount - 1) : 0

  useEffect(() => {
    if (reducedMotion || isPaused || slideCount <= 1) return

    const timer = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % slideCount)
    }, AUTO_ADVANCE_MS)

    return () => window.clearTimeout(timer)
  }, [isPaused, reducedMotion, slideCount, timerReset, visibleIndex])

  const resetTimer = () => setTimerReset((current) => current + 1)

  const goTo = (index: number) => {
    if (slideCount === 0) return
    resetTimer()
    setActiveIndex((index + slideCount) % slideCount)
  }

  const goPrevious = () => goTo(visibleIndex - 1)
  const goNext = () => goTo(visibleIndex + 1)

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null
    setIsPaused(true)
    resetTimer()
  }

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartX.current
    touchStartX.current = null
    setIsPaused(false)
    resetTimer()
    if (startX === null) return

    const endX = event.changedTouches[0]?.clientX
    if (endX === undefined) return
    const delta = endX - startX
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return
    if (delta < 0) goNext()
    else goPrevious()
  }

  if (slideCount === 0) return null

  return (
    <section
      className="min-w-0"
      role="region"
      aria-roledescription="carousel"
      aria-label="Campus highlights"
      aria-live={isPaused ? 'polite' : 'off'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative overflow-hidden rounded-[1.75rem] border border-[var(--navi-border)] bg-[var(--navi-card)] shadow-sm">
        <div
          data-home-hero-track
          className={`flex aspect-[16/9] w-full lg:aspect-[5/2] ${
            reducedMotion ? 'transition-none' : 'transition-transform duration-500 ease-out'
          }`}
          style={{ transform: `translate3d(-${visibleIndex * 100}%, 0, 0)` }}
        >
          {slides.map((slide, index) => {
            const active = index === visibleIndex
            const hasImage = isSafeLocalImage(slide.image)

            return (
              <article
                key={slide.id}
                className="relative min-w-full overflow-hidden"
                role="group"
                aria-roledescription="slide"
                aria-label={`Campus highlight ${index + 1} of ${slideCount}`}
                aria-hidden={!active}
                data-active={active ? 'true' : 'false'}
              >
                {hasImage ? (
                  <Image
                    src={slide.image}
                    alt={active ? (slide.imageAlt ?? `${slide.title} campus highlight`) : ''}
                    fill
                    sizes="(min-width: 1024px) 760px, 100vw"
                    priority={index === 0}
                    {...(index === 0 ? {} : { loading: 'lazy' as const })}
                    className="object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-[var(--navi-content)] text-[var(--navi-primary)]" aria-hidden="true">
                    <Building2 className="h-16 w-16 opacity-20 sm:h-20 sm:w-20" strokeWidth={1.25} />
                  </div>
                )}

                <div
                  className={`absolute inset-0 ${
                    hasImage
                      ? 'bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-slate-950/5'
                      : 'bg-gradient-to-t from-[var(--navi-card)] via-[var(--navi-card)]/85 to-transparent'
                  }`}
                  aria-hidden="true"
                />

                <div className="absolute inset-x-0 bottom-0 flex min-h-full flex-col justify-end p-5 text-left sm:p-7">
                  <p className={`mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] ${hasImage ? 'text-white/75' : 'text-[var(--navi-primary)]'}`}>
                    Campus highlight
                  </p>
                  <h3 className={`max-w-xl text-xl font-semibold tracking-tight sm:text-3xl ${hasImage ? 'text-white' : 'text-[var(--navi-text)]'}`}>
                    {slide.title}
                  </h3>
                  {slide.subtitle && (
                    <p className={`mt-2 max-w-xl text-sm leading-6 sm:text-base ${hasImage ? 'text-white/85' : 'text-[var(--navi-text-secondary)]'}`}>
                      {slide.subtitle}
                    </p>
                  )}
                  {slide.action && (
                    <button
                      type="button"
                      tabIndex={active ? 0 : -1}
                      onClick={() => onAction?.(slide.action as HomeAction)}
                      className={`mt-4 inline-flex min-h-11 w-fit items-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navi-primary-light)] focus-visible:ring-offset-2 ${
                        hasImage
                          ? 'bg-white text-slate-900 hover:bg-white/90'
                          : 'bg-[var(--navi-primary)] text-white hover:bg-[var(--navi-primary-dark)]'
                      }`}
                    >
                      {slide.action.label}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3 sm:p-4">
          <button
            type="button"
            onClick={goPrevious}
            disabled={slideCount <= 1}
            className="pointer-events-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/35 bg-slate-950/45 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-slate-950/65 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Previous campus highlight"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={slideCount <= 1}
            className="pointer-events-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/35 bg-slate-950/45 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-slate-950/65 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Next campus highlight"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2" aria-label="Choose campus highlight">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => goTo(index)}
            aria-label={`Show campus highlight ${index + 1}`}
            aria-current={index === visibleIndex ? 'true' : undefined}
            className={`min-h-11 min-w-11 rounded-full p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navi-primary)] focus-visible:ring-offset-2`}
          >
            <span
              aria-hidden="true"
              className={`block h-2 w-full rounded-full transition-colors ${
                index === visibleIndex ? 'bg-[var(--navi-primary)]' : 'bg-[var(--navi-border)]'
              }`}
            />
          </button>
        ))}
      </div>
    </section>
  )
}
