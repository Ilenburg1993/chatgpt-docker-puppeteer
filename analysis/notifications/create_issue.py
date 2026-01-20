#!/usr/bin/env python3
import os,sys,json
pat=os.environ.get('GITHUB_PAT')
if not pat:
    print('ERROR: set GITHUB_PAT in environment before running')
    sys.exit(1)
repo='Rajude/chatgpt-docker-puppeteer'
url=f'https://api.github.com/repos/{repo}/issues'
body=open('analysis/notifications/rotation-draft.md','r',encoding='utf-8').read()
data={'title':'URGENT: Rotate credentials — repo history scrubbed','body':body,'labels':['security','remediation']}
req_data=json.dumps(data).encode('utf-8')
import urllib.request
req=urllib.request.Request(url,data=req_data,headers={'Authorization':f'token {pat}','Accept':'application/vnd.github+json','User-Agent':'repo-cleanup-agent'})
try:
    resp=urllib.request.urlopen(req)
    r=json.load(resp)
    print('ISSUE_CREATED', r.get('html_url'))
except urllib.error.HTTPError as e:
    print('HTTP_ERROR', e.code)
    try:
        print(e.read().decode())
    except Exception:
        pass
    sys.exit(2)
