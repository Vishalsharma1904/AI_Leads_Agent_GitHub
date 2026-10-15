package ai.rudra24.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import java.util.UUID

@Composable fun CRMDetail(model:Workspace) {
    val row=model.detail?:return
    val id=row.getString("id");val profile=row.getJSONObject("profile")
    var stage by remember(id,row.optInt("version")){mutableStateOf(row.optString("stage"))}
    var phone by remember(id,row.optInt("version")){mutableStateOf(profile.optString("phone"))}
    var email by remember(id,row.optInt("version")){mutableStateOf(profile.optString("email"))}
    var note by remember(id){mutableStateOf("")};var noteKey by remember(id){mutableStateOf(UUID.randomUUID().toString())}
    var title by remember(id){mutableStateOf("")};var due by remember(id){mutableStateOf("")};var menu by remember{mutableStateOf(false)}
    val stages=listOf("new","attempted","connected","follow_up","qualified","not_interested","review_required")+if(stage=="client")listOf("client") else emptyList()
    Dialog(onDismissRequest={model.detail=null}) {
        Surface(shape=MaterialTheme.shapes.large){LazyColumn(Modifier.fillMaxWidth().heightIn(max=700.dp).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            item{Text(profile.optString("company"),style=MaterialTheme.typography.headlineSmall);Text(profile.optString("address"))}
            item{OutlinedButton(onClick={menu=true}){Text("Stage: $stage")};DropdownMenu(expanded=menu,onDismissRequest={menu=false}){stages.forEach{value->DropdownMenuItem(text={Text(value.replace('_',' '))},onClick={stage=value;menu=false})}}}
            item{OutlinedTextField(phone,{phone=it},label={Text("Phone with country code")},modifier=Modifier.fillMaxWidth(),singleLine=true)}
            item{OutlinedTextField(email,{email=it},label={Text("Email")},modifier=Modifier.fillMaxWidth(),singleLine=true)}
            item{Button(onClick={model.saveContact(stage,phone,email)},enabled=!model.busy){Text("Save contact & stage")}}
            item{OutlinedTextField(note,{note=it;noteKey=UUID.randomUUID().toString()},label={Text("CRM note")},modifier=Modifier.fillMaxWidth(),minLines=2)}
            item{Button(onClick={model.addNote(note,noteKey){note="";noteKey=UUID.randomUUID().toString()}},enabled=!model.busy&&note.isNotBlank()){Text("Save note")}}
            item{Text("Follow-ups",style=MaterialTheme.typography.titleMedium)}
            items(row.optJSONArray("tasks")?.objects()?:emptyList(),key={it.getString("id")}){task->
                Text(task.optString("title")+" · "+task.optString("status")+"\n"+task.optString("dueAt"))
                if(task.optString("status")=="open")TextButton(onClick={model.finishFollowUp(task)},enabled=!model.busy){Text("Mark completed")}
            }
            item{OutlinedTextField(title,{title=it},label={Text("New follow-up")},modifier=Modifier.fillMaxWidth(),singleLine=true)}
            item{OutlinedTextField(due,{due=it},label={Text("Due date (YYYY-MM-DD, optional)")},modifier=Modifier.fillMaxWidth(),singleLine=true)}
            item{Button(onClick={model.addFollowUp(title,due){title="";due=""}},enabled=!model.busy&&title.isNotBlank()){Text("Add follow-up")};Text("If a save times out, refresh history before retrying.",style=MaterialTheme.typography.bodySmall)}
            item{Text("Activity & call history",style=MaterialTheme.typography.titleMedium)}
            items(row.optJSONArray("activities")?.objects()?:emptyList(),key={it.getString("id")}){activity->
                Text(activity.optString("kind").replace('_',' ')+" · "+activity.optString("occurredAt"),style=MaterialTheme.typography.labelMedium)
                Text(activity.optString("note"),style=MaterialTheme.typography.bodySmall)
            }
            item{Row{TextButton(onClick={model.leadDetail(id)},enabled=!model.busy){Text("Refresh history")};TextButton(onClick={model.detail=null}){Text("Close")}}}
        }}
    }
}
