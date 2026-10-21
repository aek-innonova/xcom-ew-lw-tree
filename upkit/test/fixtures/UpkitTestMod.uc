class UpkitTestMod extends Actor
    config(UpkitTestMod);

const MAX_THINGS = 10;

enum EUpkitMode
{
    eUM_Off,
    eUM_Watch,
    eUM_Act
};

struct UpkitEntry
{
    var int iCount;
    var string strLabel;
    var EUpkitMode eMode;

    structdefaultproperties
    {
        iCount=1
        strLabel="entry"
    }
};

var config int m_iInterval;
var() float m_fScale;
var array<UpkitEntry> m_arrEntries;
var private int m_iTicks;
var EUpkitMode m_eMode;
var name m_nmLast;

static function int Clamp10(int iValue)
{
    if (iValue > MAX_THINGS) return MAX_THINGS;
    return iValue < 0 ? 0 : iValue;
}

function AddEntry(string strLabel, optional int iCount = 2)
{
    local UpkitEntry kEntry;
    local int iFound;

    kEntry.strLabel = strLabel;
    kEntry.iCount = Clamp10(iCount);
    kEntry.eMode = eUM_Watch;
    iFound = m_arrEntries.Find('strLabel', strLabel);
    if (iFound == INDEX_NONE)
        m_arrEntries.AddItem(kEntry);
    else
        m_arrEntries[iFound].iCount += kEntry.iCount;
    if (m_arrEntries.Length > MAX_THINGS)
        m_arrEntries.Remove(0, 1);
}

function string Describe()
{
    local string strOut;
    local int I;

    strOut = "UpkitTestMod:";
    for (I = 0; I < m_arrEntries.Length; I++)
    {
        strOut @= m_arrEntries[I].strLabel $ "=" $ m_arrEntries[I].iCount;
        if (Len(strOut) > 200)
        {
            strOut = Left(strOut, 200) $ "...";
            break;
        }
    }
    return Repl(strOut, "  ", " ");
}

simulated event Tick(float DeltaTime)
{
    super.Tick(DeltaTime);
    m_iTicks++;
    if (m_iTicks % m_iInterval == 0 && m_eMode != eUM_Off)
    {
        CountUnits();
    }
}

function int CountUnits()
{
    local Pawn P;
    local int iCount;

    foreach AllActors(class'Pawn', P)
    {
        if (P.Health > 0)
            iCount++;
    }
    switch (m_nmLast)
    {
        case 'None':
            m_nmLast = 'Counted';
            break;
        default:
            m_nmLast = name("Counted_" $ iCount);
    }
    return iCount;
}

auto state Watching
{
    event BeginState(name PreviousStateName)
    {
        m_eMode = eUM_Watch;
    }

Begin:
    Sleep(float(default.m_iInterval) * m_fScale);
    AddEntry("tick", 1);
    goto 'Begin';
}

defaultproperties
{
    m_iInterval=30
    m_fScale=1.5
    m_eMode=eUM_Watch
}
