import assert from 'node:assert/strict'
import { test } from 'node:test'
import { colours, initials, overrides, projectName, tile } from './icon.ts'

test('initials: two words give two capitals, one word its first two letters', () => {
  const names = {
    ultimate: 'Ul',
    RecipeBook: 'RB',
    'my-notes': 'MN',
    go: 'Go',
    api: 'Ap',
    notebook: 'No',
    myApp: 'MA',
    my_app: 'MA',
    'my app server': 'MA',
    x: 'X',
  }
  for (const [name, expected] of Object.entries(names)) assert.equal(initials(name), expected, name)
})

test('the colour comes from the name alone, one of ten, each with ink at least 4.4:1', () => {
  assert.deepEqual(colours('my-app'), colours('my-app'))
  const backgrounds = new Set(
    Array.from({ length: 200 }, (_, i) => {
      const { background, ratio } = colours(`project-${i}`)
      assert.ok(ratio >= 4.4, `${background}: ${ratio}`)
      return background
    }),
  )
  assert.equal(backgrounds.size, 10)
})

test('the ink is white on dark backgrounds and near-black on light ones', () => {
  assert.equal(colours('x', { color: '#1e3a8a' }).ink, '#ffffff')
  assert.equal(colours('x', { color: '#fde047' }).ink, '#121216')
})

test('an override sets the colour and text; an invalid colour falls back to the name', () => {
  assert.equal(colours('my-app', { color: '#E8A33D' }).background, '#e8a33d')
  assert.equal(colours('my-app', { color: 'orange' }).background, colours('my-app').background)
  const svg = decodeURIComponent(tile('my-app', { override: { text: 'Mx' }, dot: '#fbbf24' }))
  assert.match(svg, />Mx<\/text>/)
  assert.match(svg, /<circle[^>]+fill="#fbbf24"/)
  assert.doesNotMatch(decodeURIComponent(tile('my-app')), /<circle/)
})

test('the setting keeps string colour and text per name, and nothing else', () => {
  assert.deepEqual(overrides({ 'my-app': { color: '#e8a33d', text: 1 }, other: 'x', ok: {} }), {
    'my-app': { color: '#e8a33d' },
    ok: {},
  })
  assert.deepEqual(overrides(['x']), {})
})

test('a branch checkout takes its project name', () => {
  assert.equal(projectName('/home/me/src/my-app'), 'my-app')
  assert.equal(projectName('/home/me/.ultimate/projects/my-app-00c41c49/worktrees/12'), 'my-app')
})
