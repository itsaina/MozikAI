import { NextRequest, NextResponse } from 'next/server'

const PROTECTED = ['/', '/messenger']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!PROTECTED.includes(pathname)) return NextResponse.next()

  const cookie = req.cookies.get('mozik_session')?.value
  const password = process.env.ADMIN_PASSWORD

  if (!password || cookie === password) return NextResponse.next()

  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/', '/messenger'],
}
