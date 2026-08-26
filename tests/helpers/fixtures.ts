import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ffmpegPath, ffprobePath } from '../../src/main/media/ffmpeg'

const execFileAsync = promisify(execFile)

/** Built once and reused; regenerating per test would dominate the run time. */
export const FIXTURE_ROOT = join(process.cwd(), 'tests', '.fixtures')
export const COURSE_DIR = join(FIXTURE_ROOT, 'course')

export interface Fixtures {
  course: string
  intro: string
  welcome: string
  setup: string
  advanced: string
  exoticMkv: string
  longDir: string
  long: string
}

export function fixturePaths(): Fixtures {
  const intro = join(COURSE_DIR, '01 Intro')
  const advanced = join(COURSE_DIR, '02 Advanced')
  const longDir = join(COURSE_DIR, '03 Long')
  return {
    course: COURSE_DIR,
    intro,
    advanced,
    longDir,
    welcome: join(intro, '01 welcome.mp4'),
    setup: join(intro, '02 setup.mp4'),
    exoticMkv: join(advanced, 'exotic.mkv'),
    long: join(longDir, 'long lesson.mp4')
  }
}

async function synth(output: string, seconds: number, format?: string): Promise<void> {
  if (existsSync(output)) return
  await execFileAsync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=160x120:rate=12:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest',
      ...(format ? ['-f', format] : []),
      output
    ],
    { timeout: 120_000 }
  )
}

/**
 * A miniature course tree: nested folders, natural-sort traps (09 before 10),
 * a subtitle sidecar, an ignored text file, a hidden file, and one mkv that
 * forces the remux path.
 */
export async function buildFixtures(): Promise<Fixtures> {
  const paths = fixturePaths()
  await mkdir(paths.intro, { recursive: true })
  await mkdir(paths.advanced, { recursive: true })
  await mkdir(paths.longDir, { recursive: true })

  await synth(paths.welcome, 3)
  await synth(paths.setup, 2)
  await synth(join(paths.advanced, '10 last.mp4'), 1)
  await synth(join(paths.advanced, '09 ninth.mp4'), 1)
  await synth(paths.exoticMkv, 1, 'matroska')
  // Long enough that the resume test can seek, save progress and come back.
  await synth(paths.long, 40)

  await writeFile(
    join(paths.intro, '01 welcome.srt'),
    '1\n00:00:00,500 --> 00:00:02,000\nHello there\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line\n',
    'utf8'
  )
  await writeFile(join(paths.intro, '01 welcome.tr.vtt'), 'WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nMerhaba\n', 'utf8')
  await writeFile(join(COURSE_DIR, 'notes.txt'), 'not media', 'utf8')
  await writeFile(join(COURSE_DIR, '.hidden.mp4'), 'not real', 'utf8')
  await writeFile(join(FIXTURE_ROOT, 'outside-secret.txt'), 'must never be served', 'utf8')

  return paths
}

export async function probeCodecs(file: string): Promise<{ container: string; video?: string }> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file
  ])
  const json = JSON.parse(stdout) as {
    format?: { format_name?: string }
    streams?: Array<{ codec_type?: string; codec_name?: string }>
  }
  return {
    container: json.format?.format_name ?? '',
    video: json.streams?.find((s) => s.codec_type === 'video')?.codec_name
  }
}

export async function ffmpegUsable(): Promise<boolean> {
  try {
    await execFileAsync(ffmpegPath, ['-version'], { timeout: 15_000 })
    return true
  } catch {
    return false
  }
}
