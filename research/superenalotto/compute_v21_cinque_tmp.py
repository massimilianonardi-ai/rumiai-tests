from collections import Counter, defaultdict
from itertools import combinations
import csv, math, statistics
from pathlib import Path
p=Path('/mnt/data/estrazioni_con_ritardi.csv')
rows=sorted(list(csv.DictReader(p.open(encoding='utf-8-sig',newline=''), delimiter=';')),key=lambda z:(z['data'],int(z['concorso'])))
seen={}; occurrences=defaultdict(list)
per=[]; N=len(rows)
for i,r in enumerate(rows):
 s=tuple(int(r['n'+str(j)]) for j in range(1,7))
 combos=list(combinations(s,5))
 prev=[seen.get(c,0) for c in combos]
 per.append({'index':i,'data':r['data'],'concorso':r['concorso'],'numbers':s,'num_previously_seen':sum(bool(x) for x in prev),'prev_counts':prev, 'max_earlier':max(prev), 'total_prior':sum(prev)})
 for c in combos:
  seen[c]=seen.get(c,0)+1;occurrences[c].append(i)
repeated={k:v for k,v in occurrences.items() if len(v)>1}
print('n',N,'combinations',N*6,'unique',len(seen),'repeated unique',len(repeated),'extra occurrences',sum(len(v)-1 for v in repeated.values()))
print('count freq repeated',Counter(len(v) for v in repeated.values()))
print('draws with >=1 prior',sum(v['num_previously_seen']>0 for v in per),'sum repeated slots',sum(v['num_previously_seen'] for v in per),'max prior per draw',max(v['num_previously_seen'] for v in per))
for c,v in sorted(repeated.items(),key=lambda kv:kv[1]):
 print(c,'occ',len(v),'draws',[(rows[i]['data'],rows[i]['concorso'], tuple(int(rows[i]['n'+str(j)]) for j in range(1,7))) for i in v]);
# Expected number of pair collisions of 5s: 2 draws share 5 or 6 numbers, exact probability
C=math.comb(90,6)
p5=math.comb(6,5)*math.comb(84,1)/C
p6=1/C
E=math.comb(N,2)*(p5*1+p6*6)
print('E collisions (repeated 5-subset occurrences pair)',E,'P(draw pair overlaps >=5)',p5+p6,'E draw pair collisions',math.comb(N,2)*(p5+p6))
# Basic pairwise intersections number shared k for all pairs efficiently via combinatorial counts of subsets for k=1..6
cntk=[]
for k in range(1,7):
 freq=Counter(q for i,s in enumerate(per) for q in combinations(s['numbers'],k))
 cntk.append(sum(math.comb(v,2) for v in freq.values()))
print('pairs >=k sums',cntk)
exact=[0]*7
for k in range(6,0,-1):
 exact[k]=cntk[k-1]-sum(math.comb(j,k)*exact[j] for j in range(k+1,7))
exact[0]=math.comb(N,2)-sum(exact[1:]);print('overlaps of past draw pairs',exact)
