#!/usr/bin/env python3
"""Minimal reader for uncompressed Unreal Engine 3 packages (.upk): summary,
name table, import and export tables, and enum values. Used by upk_enums.py."""


import struct, sys

class R:
    def __init__(s, b, o=0): s.b=b; s.o=o
    def i32(s): v=struct.unpack_from('<i',s.b,s.o)[0]; s.o+=4; return v
    def u32(s): v=struct.unpack_from('<I',s.b,s.o)[0]; s.o+=4; return v
    def i16(s): v=struct.unpack_from('<h',s.b,s.o)[0]; s.o+=2; return v
    def fstr(s):
        n=s.i32()
        if n==0: return ''
        if n<0:
            v=s.b[s.o:s.o-2*n].decode('utf-16le').rstrip('\0'); s.o+=-2*n; return v
        v=s.b[s.o:s.o+n].decode('latin-1').rstrip('\0'); s.o+=n; return v

def load(path):
    b=open(path,'rb').read()
    r=R(b)
    tag=r.u32(); assert tag==0x9e2a83c1, hex(tag)
    ver=r.i16(); lic=r.i16(); hdr=r.i32(); folder=r.fstr(); flags=r.u32()
    nc,no,ec,eo,ic,io_=[r.i32() for _ in range(6)]
    dep=r.i32()
    if ver>=623: r.i32(); r.i32(); r.i32(); r.i32()
    guid=b[r.o:r.o+16]; r.o+=16
    gens=r.i32(); r.o+=12*gens
    engine=r.i32(); cooker=r.i32(); cflags=r.i32(); chunks=r.i32()
    info=dict(ver=ver,lic=lic,flags=hex(flags),names=nc,exports=ec,imports=ic,compression=cflags,chunks=chunks)
    if chunks: return info, None
    names=[]; r.o=no
    for _ in range(nc):
        names.append(r.fstr()); r.o+=8  # flags (qword)
    def nm(i, num=0): return names[i] + (f'_{num-1}' if num else '')
    imports=[]; r.o=io_
    for _ in range(ic):
        pkg=r.i32(); r.i32(); cls=r.i32(); r.i32(); outer=r.i32(); name=r.i32(); num=r.i32()
        imports.append(dict(cls=names[cls], name=nm(name,num), outer=outer))
    exports=[]; r.o=eo
    for _ in range(ec):
        cls=r.i32(); sup=r.i32(); outer=r.i32(); name=r.i32(); num=r.i32(); arch=r.i32()
        oflags=r.u32(); r.u32()
        size=r.i32(); off=r.i32(); eflags=r.u32()
        ngen=r.i32(); r.o+=4*ngen
        r.o+=16+4  # package guid + package flags
        exports.append(dict(cls=cls, sup=sup, outer=outer, name=nm(name,num), size=size, off=off))
    return info, dict(b=b, names=names, imports=imports, exports=exports, nm=nm)

def class_name(pk, idx):
    if idx<0: return pk['imports'][-idx-1]['name']
    if idx>0: return pk['exports'][idx-1]['name']
    return 'Class'

if __name__=='__main__':
    info,pk=load(sys.argv[1])
    print(info)
    if pk:
        from collections import Counter
        print(Counter(class_name(pk,e['cls']) for e in pk['exports']).most_common(15))
        enums=[e for e in pk['exports'] if class_name(pk,e['cls'])=='Enum']
        print(len(enums),'enums; e.g.', [e['name'] for e in enums][:40])

def enum_values(pk, export):
    b=pk['b']; r=R(b, export['off'])
    r.i32()  # NetIndex
    # tagged properties until None
    while True:
        ni=r.i32(); r.i32()
        if pk['names'][ni]=='None': break
        r.i32(); r.i32()  # type name
        size=r.i32(); r.i32()  # array index
        r.o+=size  # simplistic; enums carry no properties in practice
    r.i32()  # UField.Next
    n=r.i32()
    out=[]
    for _ in range(n):
        ni=r.i32(); num=r.i32(); out.append(pk['nm'](ni,num))
    return out

def enums(pk):
    return {e['name']: e for e in pk['exports'] if class_name(pk,e['cls'])=='Enum'}
