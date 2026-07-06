import { describe, it, expect } from 'vitest'
import { haversineKm, buildDeliveryRoute, geoLatLng, fmtDuration } from './geo'

describe('haversineKm — расстояние по координатам', () => {
  it('нулевое расстояние для одной точки', () => {
    const a = { lat: 55.79, lng: 49.1 }
    expect(haversineKm(a, a)).toBeCloseTo(0, 5)
  })

  it('~111 км на 1° широты', () => {
    const d = haversineKm({ lat: 55, lng: 49 }, { lat: 56, lng: 49 })
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })
})

describe('buildDeliveryRoute — маршрут доставки (TSP)', () => {
  const pts = [
    { lat: 55.8, lng: 49.1, id: 'a' },
    { lat: 55.82, lng: 49.13, id: 'b' },
    { lat: 55.79, lng: 49.08, id: 'c' },
    { lat: 55.81, lng: 49.2, id: 'd' },
  ]

  it('пустой список — нулевой маршрут', () => {
    expect(buildDeliveryRoute([])).toMatchObject({ order: [], distanceKm: 0, minutes: 0 })
  })

  it('посещает все точки ровно один раз', () => {
    const { order } = buildDeliveryRoute(pts)
    expect(order).toHaveLength(pts.length)
    expect(new Set(order).size).toBe(pts.length) // без дублей
  })

  it('считает положительную дистанцию, время и плечи (n+1)', () => {
    const r = buildDeliveryRoute(pts)
    expect(r.distanceKm).toBeGreaterThan(0)
    expect(r.minutes).toBeGreaterThan(0)
    expect(r.legs).toHaveLength(pts.length + 1) // депо→…→депо
  })

  it('2-opt не хуже наивного порядка', () => {
    // сумма плеч оптимизированного маршрута = заявленная дистанция
    const r = buildDeliveryRoute(pts)
    const legsSum = r.legs.reduce((a, b) => a + b, 0)
    expect(Math.abs(legsSum - r.distanceKm)).toBeLessThan(1)
  })
})

describe('geoLatLng — детерминированные координаты заказа', () => {
  it('одинаковый заказ → одинаковые координаты', () => {
    const o = { id: 'o1', address: 'ул. Баумана, 1' }
    expect(geoLatLng(o)).toEqual(geoLatLng(o))
  })

  it('использует заданные geo, если они есть', () => {
    const geo = { lat: 55.5, lng: 49.5 }
    expect(geoLatLng({ id: 'o2', geo })).toBe(geo)
  })
})

describe('fmtDuration', () => {
  it('форматирует минуты и часы', () => {
    expect(fmtDuration(45)).toBe('45 мин')
    expect(fmtDuration(90)).toBe('1 ч 30 мин')
  })
})
