'use client'

import { useState, useCallback } from 'react'
import { usePublicStore } from '@/store/public-store'
import { useHydrated } from '@/hooks/useHydrated'
import { ChevronRight, SkipForward, Map, MapPin, Landmark } from 'lucide-react'

interface OnboardingSlide {
  title: string
  description: string
  icon: React.ReactNode
}

const slides: OnboardingSlide[] = [
  {
    title: 'Navigate Your Campus',
    description: 'Find your way across multiple campuses with indoor and outdoor turn-by-turn directions.',
    icon: <Map className="h-16 w-16 text-[var(--navi-primary)]" />,
  },
  {
    title: 'Real-time Step Guidance',
    description: 'Get step-by-step directions with visual cues, floor changes, and distance tracking.',
    icon: <MapPin className="h-16 w-16 text-[var(--navi-success)]" />,
  },
  {
    title: 'Discover Campus Life',
    description: 'Explore buildings, find faculty offices, labs, and discover what your campus has to offer.',
    icon: <Landmark className="h-16 w-16 text-[var(--navi-accent)]" />,
  },
]

export function SplashOnboarding() {
  const [currentSlide, setCurrentSlide] = useState(0)
  const completeOnboarding = usePublicStore((s) => s.completeOnboarding)
  const onboardingComplete = usePublicStore((s) => s.onboardingComplete)
  const [animatingOut, setAnimatingOut] = useState(false)
  const hydrated = useHydrated()

  const handleNext = useCallback(() => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide((i) => i + 1)
    } else {
      handleComplete()
    }
  }, [currentSlide])

  const handleComplete = useCallback(() => {
    setAnimatingOut(true)
    setTimeout(() => {
      completeOnboarding()
    }, 400)
  }, [completeOnboarding])

  const handleSkip = useCallback(() => {
    handleComplete()
  }, [handleComplete])

  if (!hydrated) return null
  if (onboardingComplete) return null

  const slide = slides[currentSlide]
  const isLast = currentSlide === slides.length - 1

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col bg-[var(--navi-card)] transition-opacity duration-500
        ${animatingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <div className="flex justify-end p-4">
        <button
          onClick={handleSkip}
          className="flex items-center gap-1 text-sm text-[var(--navi-text-secondary)] hover:text-[var(--navi-text)] transition-colors"
          aria-label="Skip onboarding"
        >
          <SkipForward className="h-4 w-4" />
          Skip
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="mb-8" aria-hidden="true">
          {slide.icon}
        </div>
        <h1 className="text-2xl font-bold text-[var(--navi-text)] mb-3">
          {slide.title}
        </h1>
        <p className="text-sm text-[var(--navi-text-secondary)] max-w-xs leading-relaxed">
          {slide.description}
        </p>
      </div>

      <div className="px-8 pb-12 flex flex-col items-center gap-6">
        <div className="flex items-center gap-2">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300
                ${i === currentSlide
                  ? 'w-6 bg-[var(--navi-primary)]'
                  : 'w-2 bg-[var(--navi-border)]'
                }`}
            />
          ))}
        </div>

        <button
          onClick={handleNext}
          className="flex items-center gap-2 bg-[var(--navi-primary)] text-white px-6 py-3 rounded-[var(--navi-radius-sm)] font-medium text-sm shadow-sm hover:bg-[var(--navi-primary-dark)] transition-colors"
        >
          {isLast ? 'Get Started' : 'Next'}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
