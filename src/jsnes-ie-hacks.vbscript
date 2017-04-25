' http://stackoverflow.com/questions/1919972/how-do-i-access-xhr-responsebody-from-javascript
Function JSNESBinaryToArray(Binary)
  Dim i
  ReDim byteArray(LenB(Binary))
  For i = 1 To LenB(Binary)
    byteArray(i-1) = AscB(MidB(Binary, i, 1))
  Next
  JSNESBinaryToArray = byteArray
End Function
