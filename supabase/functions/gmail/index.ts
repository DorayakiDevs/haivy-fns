import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        message: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { to, subject, html, text, cc, bcc } = await req.json();
    // Validate required fields
    if (!to || !subject) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Missing required fields: to, subject'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!html && !text) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Either html or text content is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Send email using Gmail API
    const response = await sendWithGmailAPI({
      to,
      subject,
      html,
      text,
      cc,
      bcc
    });
    return new Response(JSON.stringify(response), {
      status: response.success ? 200 : 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Email function error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Internal server error',
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
async function sendWithGmailAPI(emailData) {
  try {
    // Get fresh access token
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return {
        success: false,
        message: 'Failed to get access token'
      };
    }
    // Create the email message
    const rawMessage = createEmailMessage(emailData);
    // Send via Gmail API
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: rawMessage
      })
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gmail API error:', errorData);
      return {
        success: false,
        message: `Gmail API error: ${errorData.error?.message || 'Unknown error'}`,
        details: errorData
      };
    }
    const result = await response.json();
    return {
      success: true,
      message: 'Email sent successfully via Gmail API',
      messageId: result.id
    };
  } catch (error) {
    console.error('Gmail API function error:', error);
    return {
      success: false,
      message: `Gmail API error: ${error.message}`
    };
  }
}
async function getAccessToken() {
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!refreshToken || !clientId || !clientSecret) {
    console.error('Missing OAuth2 credentials');
    throw new Error('Missing OAuth2 credentials: GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
  }
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      })
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error('OAuth2 refresh error:', errorData);
      throw new Error(`OAuth2 error: ${errorData.error_description || errorData.error}`);
    }
    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Failed to refresh access token:', error);
    return null;
  }
}
// Helper function to properly encode Unicode strings to base64
function unicodeToBase64(str) {
  // Convert Unicode string to UTF-8 bytes, then to base64
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  // Convert Uint8Array to string for btoa
  let binary = '';
  for(let i = 0; i < data.byteLength; i++){
    binary += String.fromCharCode(data[i]);
  }
  // Base64 encode and make URL-safe
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
// Enhanced function to encode subject with RFC 2047 for international characters
function encodeSubject(subject) {
  // Check if subject contains non-ASCII characters
  if (/[^\x00-\x7F]/.test(subject)) {
    // Encode using RFC 2047 format for international characters
    const encoder = new TextEncoder();
    const encoded = encoder.encode(subject);
    let base64 = '';
    // Convert to base64
    const binary = Array.from(encoded, (byte)=>String.fromCharCode(byte)).join('');
    base64 = btoa(binary);
    return `=?UTF-8?B?${base64}?=`;
  }
  return subject;
}
function createEmailMessage(emailData) {
  const defaultFrom = 'haivy.health@gmail.com';
  // Create email headers with proper encoding
  const headers = [
    `From: ${defaultFrom}`,
    `To: ${Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to}`,
    `Subject: ${encodeSubject(emailData.subject)}`,
    'MIME-Version: 1.0'
  ];
  if (emailData.cc) {
    headers.push(`Cc: ${Array.isArray(emailData.cc) ? emailData.cc.join(', ') : emailData.cc}`);
  }
  if (emailData.bcc) {
    headers.push(`Bcc: ${Array.isArray(emailData.bcc) ? emailData.bcc.join(', ') : emailData.bcc}`);
  }
  let body = '';
  // Handle content with proper UTF-8 encoding
  if (emailData.html && emailData.text) {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = `
--${boundary}
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

${emailData.text}

--${boundary}
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: 8bit

${emailData.html}

--${boundary}--`;
  } else if (emailData.html) {
    headers.push('Content-Type: text/html; charset=UTF-8');
    headers.push('Content-Transfer-Encoding: 8bit');
    body = emailData.html;
  } else {
    headers.push('Content-Type: text/plain; charset=UTF-8');
    headers.push('Content-Transfer-Encoding: 8bit');
    body = emailData.text;
  }
  // Combine headers and body
  const email = headers.join('\r\n') + '\r\n\r\n' + body;
  // Use the Unicode-safe base64 encoding function
  return unicodeToBase64(email);
}
