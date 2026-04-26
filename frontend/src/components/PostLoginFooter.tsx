import type { MouseEvent } from 'react'

function noopLink(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault()
}

export default function PostLoginFooter() {
  return (
    <footer className="post-login-footer">
      <div className="post-login-footer-inner">
        <p className="post-login-footer-legal">
          Zanskar Securities Private Limited is a SEBI registered stock broker
          (INZ000316631), Exchange Membership No. : NSE: 90370 | BSE: 6870 |
          MSEI : 85550 | CDSL DP Id: 121020000 | MCX - 57510. Address: 4th
          floor (left wing), Raheja point 17/2, Magarath Road, Ashok Nagar, Opp
          Garuda Mall, Bengaluru, Karnataka-560025 | E-mail:
          Compliance@zanskarsec.com | Telephone No.: +91 81233 07485 | CM ID -
          M70103
        </p>

        <div className="post-login-footer-meta">
          <span>Copyrights &copy; 2026. All Rights Reserved. CIN: U64199KA2023PTC17563</span>
          <span className="post-login-footer-sep">|</span>
          <a href="" onClick={noopLink}>Terms &amp; Conditions</a>
          <a href="" onClick={noopLink}>Disclaimer</a>
          <a href="" onClick={noopLink}>Privacy Policy</a>
          <span className="post-login-footer-sep">|</span>
          <span>
            Charts powered by{' '}
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              TradingView
            </a>
          </span>
        </div>
      </div>
    </footer>
  )
}
