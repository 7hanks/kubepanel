#!/usr/bin/env python3
"""Remove only stopped KubePanel deployment leftovers; retain images and volumes."""
import json,re,subprocess,sys

def prune(container='kubepanel'):
    pattern=re.compile(re.escape(container)+r'-(?:rollback-\d{8}T\d{6}Z|candidate-[0-9a-f]{12})$')
    names=subprocess.check_output(['docker','ps','-a','--format','{{.Names}}'],text=True).splitlines()
    removed=[]
    for name in names:
        if not pattern.fullmatch(name):continue
        info=json.loads(subprocess.check_output(['docker','inspect',name],text=True))[0]
        labels=info.get('Config',{}).get('Labels') or {}
        if info.get('State',{}).get('Running') or info.get('State',{}).get('Status') not in ('exited','created','dead'):continue
        if labels.get('org.opencontainers.image.title')!='KubePanel':continue
        if not re.fullmatch('[0-9a-f]{40}',labels.get('org.opencontainers.image.revision','')):continue
        # No --force or --volumes: a container started meanwhile must not be removed.
        subprocess.run(['docker','rm',info['Id']],check=True,stdout=subprocess.DEVNULL)
        removed.append(name)
    return removed

if __name__=='__main__':print(json.dumps({'removedInactiveContainers':prune(sys.argv[1] if len(sys.argv)>1 else 'kubepanel')}))
